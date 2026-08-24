const mongoose = require('mongoose');

const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');
const Item = require('../models/Item');
const SafeHub = require('../models/SafeHub');
const DonationRequest = require('../models/DonationRequest');
const DonationOffer = require('../models/DonationOffer');
const donationRequestRepository = require('../repositories/donationRequestRepository');
const donationOfferRepository = require('../repositories/donationOfferRepository');
const { toPublicRequest } = require('../dtos/donationRequestDto');
const { toPublicOffer } = require('../dtos/donationOfferDto');
const AppError = require('../utils/AppError');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/uploadToCloudinary');
const { validateImageFile } = require('../utils/imageValidation');
const notifyUser = require('../utils/notifyUser');
const {
  isPhoneVerificationEnabled,
} = require('../middlewares/phoneVerificationFeature');

const DEFAULT_REQUEST_LIMIT = 1;
const DEFAULT_REQUEST_EXPIRY_DAYS = 30;
const DEFAULT_PENDING_OFFERS_LIMIT = 5;
const DEFAULT_BOOKINGS_LIMIT = 3;

const getMinTrustLevel = (settings) => settings.minTrustLevelForRequests ?? 2;
const getObjectId = (value) => value?._id ?? value;
const idsEqual = (left, right) =>
  Boolean(left && right && getObjectId(left).toString() === getObjectId(right).toString());
const isAdminRole = (role) => ['admin', 'super_admin'].includes(role);

const isPastExpiry = (request, now = new Date()) => {
  if (request?.status !== 'active' || !request.expiresAt) return false;
  const expiresAt = new Date(request.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
};

const toEffectivePublicRequest = (request, options = {}) => {
  const value = request?.toObject ? request.toObject() : { ...request };
  const now = options.now ?? new Date();
  if (isPastExpiry(value, now)) value.status = 'expired';
  return toPublicRequest(value, {
    includeFulfilledItem: Boolean(options.includeFulfilledItem),
  });
};

const queueBackground = (label, task) => {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => console.warn(`[${label}] فشلت المهمة الخلفية:`, error.message));
  });
};

const uniqueById = (offers) => {
  const seen = new Set();
  return offers.filter((offer) => {
    const id = getObjectId(offer.donor)?.toString();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const cleanupOfferImages = async (offers, label) => {
  const images = offers.filter((offer) => offer?._id && offer.cloudinaryId);
  if (!images.length) return;

  const results = await Promise.allSettled(images.map(async (offer) => {
    await deleteFromCloudinary(offer.cloudinaryId);
    await DonationOffer.updateOne(
      { _id: offer._id, cloudinaryId: offer.cloudinaryId },
      { $set: { imageUrl: null, cloudinaryId: null } }
    );
  }));

  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) {
    console.warn(`[${label}] تعذر تنظيف ${failed} صورة/صور من Cloudinary`);
  }
};

const endSession = async (session) => {
  try {
    await session.endSession();
  } catch (error) {
    console.warn('[DonationRequest] تعذر إنهاء MongoDB session:', error.message);
  }
};

const isTransactionConflict = (error) =>
  [11000, 112, 251].includes(error?.code)
  || error?.hasErrorLabel?.('TransientTransactionError')
  || error?.hasErrorLabel?.('UnknownTransactionCommitResult');

const normalizeOfferDuplicate = (error) => {
  if (error?.code !== 11000) return error;
  return new AppError(
    'لقد قدّمت عرضاً لهذا الطلب مسبقاً ⏳',
    409,
    'ALREADY_OFFERED'
  );
};

const notifyRejectedOffers = async (offers, request, reason) => {
  const body = reason === 'expired'
    ? `انتهت مدة طلب "${request.title}" قبل اختيار عرض.`
    : `تم اختيار عرض آخر لطلب "${request.title}" — شكراً لمبادرتك 🙏`;

  await Promise.allSettled(uniqueById(offers).map((offer) =>
    notifyUser(getObjectId(offer.donor), {
      type: reason === 'expired' ? 'request_expired' : 'offer_rejected',
      title: reason === 'expired' ? 'انتهت مدة طلب التبرع' : 'لم يتم اختيار عرضك هذه المرة',
      body,
      actionUrl: `/donation-requests/${request._id}`,
      metadata: {
        requestId: request._id.toString(),
        offerId: offer._id.toString(),
      },
    })
  ));
};

const expireSingleRequest = async (requestId, now = new Date()) => {
  const session = await mongoose.startSession();
  let request = null;
  let expiredOffers = [];

  try {
    session.startTransaction();

    request = await DonationRequest.findOneAndUpdate(
      {
        _id: requestId,
        status: 'active',
        expiresAt: { $lte: now },
      },
      { $set: { status: 'expired' } },
      { new: true, session, runValidators: true }
    ).lean();

    if (!request) {
      await session.abortTransaction();
      return null;
    }

    expiredOffers = await DonationOffer.find(
      { request: requestId, status: 'pending' },
      '_id donor cloudinaryId',
      { session }
    ).lean();

    if (expiredOffers.length) {
      await DonationOffer.updateMany(
        { request: requestId, status: 'pending' },
        { $set: { status: 'request_expired' } },
        { session, runValidators: true }
      );
    }

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await endSession(session);
  }

  queueBackground('expireDonationRequest', async () => {
    await cleanupOfferImages(expiredOffers, 'expireDonationRequest');
    await Promise.allSettled([
      notifyUser(request.requester, {
        type: 'request_expired',
        title: 'انتهت مدة طلب التبرع',
        body: `انتهت مدة طلبك "${request.title}" دون اختيار عرض.`,
        actionUrl: `/donation-requests/${request._id}`,
        metadata: { requestId: request._id.toString() },
      }),
      notifyRejectedOffers(expiredOffers, request, 'expired'),
    ]);
  });

  return request;
};

exports.createRequestLogic = async (body, userId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel isVerified').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (!user.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  const minLevel = getMinTrustLevel(settings);
  if ((user.trustLevel ?? 1) < minLevel) {
    throw new AppError(
      `يجب أن يكون مستوى حسابك Level ${minLevel} على الأقل لنشر طلب تبرع 🌟`,
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const maxRequests = settings.maxActiveRequestsPerMonth ?? DEFAULT_REQUEST_LIMIT;
  const usedThisMonth = await donationRequestRepository.countAllMonthlyRequests({
    userId,
    month: currentMonth,
  });

  if (usedThisMonth >= maxRequests) {
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxRequests} طلب في الشهر الواحد (بما فيها الملغية)`,
      429,
      'MONTHLY_LIMIT_EXCEEDED'
    );
  }

  if (!settings.categories?.includes(body.category))
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');

  if (settings.locations?.length && !settings.locations.includes(body.location))
    throw new AppError(`المنطقة "${body.location}" غير مدعومة`, 400, 'INVALID_LOCATION');

  const expiresAt = new Date();
  expiresAt.setDate(
    expiresAt.getDate() + (settings.requestExpiryDays ?? DEFAULT_REQUEST_EXPIRY_DAYS)
  );

  const request = await donationRequestRepository.createRequest({
    title: body.title.trim(),
    description: body.description?.trim() || null,
    category: body.category,
    location: body.location.trim(),
    urgency: body.urgency ?? 'medium',
    requester: userId,
    month: currentMonth,
    expiresAt,
    status: 'active',
  });

  return {
    msg: 'تم نشر طلبك بنجاح 🎉',
    request: toEffectivePublicRequest(request),
  };
};

exports.getDonationRequestsLogic = async (query, userId = null) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit = Math.min(maxPageSize, Math.max(1, Number.parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  const mine = String(query.mine).toLowerCase() === 'true';
  const filter = {};

  if (mine && !userId)
    throw new AppError('يجب تسجيل الدخول لعرض طلباتك', 401, 'NO_TOKEN');

  if (query.category && query.category !== 'all') {
    if (!settings.categories?.includes(query.category))
      throw new AppError('التصنيف المطلوب غير صالح', 400, 'INVALID_CATEGORY');
    filter.category = query.category;
  }

  if (query.location && query.location !== 'all') {
    const location = String(query.location).trim();
    if (settings.locations?.length && !settings.locations.includes(location))
      throw new AppError('المنطقة المطلوبة غير صالحة', 400, 'INVALID_LOCATION');
    filter.location = location;
  }

  if (query.urgency) {
    if (!['low', 'medium', 'high'].includes(query.urgency))
      throw new AppError('درجة الاستعجال غير صالحة', 400, 'INVALID_URGENCY');
    filter.urgency = query.urgency;
  }

  if (mine) {
    filter.requester = userId;
  } else {
    filter.status = 'active';
    filter.expiresAt = { $gt: new Date() };
  }

  const [requests, total] = await Promise.all([
    donationRequestRepository.findRequests({ filter, skip, limit }),
    donationRequestRepository.countRequests(filter),
  ]);

  return {
    requests: requests.map((request) => toEffectivePublicRequest(request, {
      includeFulfilledItem: mine,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
};

exports.cancelRequestLogic = async (requestId, userId) => {
  const session = await mongoose.startSession();
  let request;
  let cancelledOffers = [];

  try {
    session.startTransaction();
    request = await DonationRequest.findOneAndUpdate(
      {
        _id: requestId,
        requester: userId,
        status: 'active',
        expiresAt: { $gt: new Date() },
      },
      { $set: { status: 'cancelled' } },
      { new: true, session, runValidators: true }
    ).lean();

    if (!request) {
      throw new AppError(
        'الطلب غير موجود أو لم يعد قابلاً للإلغاء',
        409,
        'REQUEST_NOT_CANCELLABLE'
      );
    }

    cancelledOffers = await DonationOffer.find(
      { request: requestId, status: 'pending' },
      '_id donor cloudinaryId',
      { session }
    ).lean();

    if (cancelledOffers.length) {
      await DonationOffer.updateMany(
        { request: requestId, status: 'pending' },
        { $set: { status: 'cancelled_by_requester' } },
        { session, runValidators: true }
      );
    }

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await endSession(session);
  }

  queueBackground('cancelDonationRequest', async () => {
    await cleanupOfferImages(cancelledOffers, 'cancelDonationRequest');
    await Promise.allSettled(uniqueById(cancelledOffers).map((offer) =>
      notifyUser(getObjectId(offer.donor), {
        type: 'request_cancelled_by_requester',
        title: 'تم إلغاء طلب التبرع',
        body: `ألغى صاحب طلب "${request.title}" الطلب — شكراً لمبادرتك.`,
        actionUrl: `/donation-requests/${request._id}`,
        metadata: {
          requestId: request._id.toString(),
          offerId: offer._id.toString(),
        },
      })
    ));
  });

  return { msg: 'تم إلغاء الطلب ✅' };
};

exports.getMyRequestsLogic = async (userId) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [requests, settings, usedThisMonth] = await Promise.all([
    donationRequestRepository.findUserRequests(userId),
    SystemSettings.getCached(),
    donationRequestRepository.countAllMonthlyRequests({ userId, month: currentMonth }),
  ]);
  const max = settings.maxActiveRequestsPerMonth ?? DEFAULT_REQUEST_LIMIT;

  return {
    requests: requests.map((request) => toEffectivePublicRequest(request, {
      includeFulfilledItem: true,
    })),
    quota: {
      used: usedThisMonth,
      max,
      remaining: Math.max(0, max - usedThisMonth),
    },
  };
};

exports.submitOfferLogic = async (requestId, donorId, body, file) => {
  const [request, donor, settings] = await Promise.all([
    donationRequestRepository.findActiveRequestById(requestId),
    User.findById(donorId).select('isVerified trustLevel phoneVerified name').lean(),
    SystemSettings.getCached(),
  ]);

  if (!request)
    throw new AppError('الطلب غير موجود أو غير نشط', 404, 'REQUEST_NOT_FOUND');
  if (!donor)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (idsEqual(request.requester, donorId))
    throw new AppError('لا يمكنك التبرع لطلبك الخاص 🚫', 400, 'CANNOT_OFFER_OWN_REQUEST');
  if (!donor.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  const donorLevel = donor.trustLevel ?? 1;
  if (isPhoneVerificationEnabled() && !donor.phoneVerified && donorLevel < 2) {
    throw new AppError(
      'يجب التحقق من رقم هاتفك أولاً للتبرع 📱',
      403,
      'PHONE_NOT_VERIFIED'
    );
  }

  const minLevel = settings.minTrustLevelForDonating ?? 1;
  if (donorLevel < minLevel)
    throw new AppError(`يلزم Level ${minLevel} على الأقل للتبرع`, 403, 'INSUFFICIENT_TRUST_LEVEL');

  const [alreadyOffered, safeHub, pendingOffersCount] = await Promise.all([
    donationOfferRepository.existsByRequestAndDonor(requestId, donorId),
    body.safeHub
      ? SafeHub.findOne({ _id: body.safeHub, isActive: { $ne: false } }).lean()
      : Promise.resolve(null),
    donationOfferRepository.countPendingOffersByDonor(donorId),
  ]);

  if (alreadyOffered)
    throw new AppError('لقد قدّمت عرضاً لهذا الطلب مسبقاً ⏳', 409, 'ALREADY_OFFERED');
  if (settings.requireHubForBooking && !body.safeHub)
    throw new AppError('يجب اختيار نقطة استلام آمنة', 400, 'SAFE_HUB_REQUIRED');
  if (body.safeHub && !safeHub)
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');

  const maxPendingOffers = settings.maxPendingOffersPerDonor ?? DEFAULT_PENDING_OFFERS_LIMIT;
  if (pendingOffersCount >= maxPendingOffers) {
    throw new AppError(
      `لديك ${pendingOffersCount} عرض معلّق — انتظر حتى يُعالَج بعضها`,
      429,
      'MAX_PENDING_OFFERS_REACHED'
    );
  }

  let uploaded = null;
  let session = null;
  try {
    if (file) {
      validateImageFile(file);
      uploaded = await uploadToCloudinary(file.buffer, 'aoun-request-offers');
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const activeRequest = await DonationRequest.updateOne(
      {
        _id: requestId,
        status: 'active',
        expiresAt: { $gt: new Date() },
      },
      { $currentDate: { updatedAt: true } },
      { session }
    );
    if (activeRequest.matchedCount !== 1) {
      throw new AppError(
        'الطلب لم يعد نشطاً؛ حدّث الصفحة',
        409,
        'REQUEST_NOT_AVAILABLE'
      );
    }

    const offer = await donationOfferRepository.createOffer({
      request: requestId,
      donor: donorId,
      safeHub: safeHub?._id ?? null,
      condition: body.condition,
      description: body.description?.trim() || null,
      imageUrl: uploaded?.secure_url ?? null,
      cloudinaryId: uploaded?.public_id ?? null,
      status: 'pending',
    }, session);

    await session.commitTransaction();

    queueBackground('submitDonationOffer', () =>
      notifyUser(getObjectId(request.requester), {
        type: 'request_new_offer',
        title: 'عرض تبرع جديد! 🎁',
        body: `${donor.name} قدّم عرضاً لطلب "${request.title}" — راجع التفاصيل.`,
        actionUrl: `/donation-requests/${request._id}`,
        metadata: {
          requestId: request._id.toString(),
          offerId: offer._id.toString(),
        },
      })
    );

    return {
      msg: 'تم إرسال عرضك لصاحب الطلب بنجاح 🎉',
      offerId: offer._id.toString(),
      status: 'pending',
    };
  } catch (error) {
    if (session?.inTransaction()) await session.abortTransaction();
    if (uploaded?.public_id) {
      try {
        await deleteFromCloudinary(uploaded.public_id);
      } catch (cleanupError) {
        console.warn('[submitDonationOffer] تعذر تنظيف الصورة بعد فشل الحفظ:', cleanupError.message);
      }
    }
    throw normalizeOfferDuplicate(error);
  } finally {
    if (session) await endSession(session);
  }
};

exports.getOffersLogic = async (requestId, userId) => {
  const request = await DonationRequest.findById(requestId)
    .select('requester status expiresAt')
    .lean();

  if (!request)
    throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');
  if (!idsEqual(request.requester, userId))
    throw new AppError('غير مصرح لك برؤية هذه العروض 🚫', 403, 'FORBIDDEN');

  if (isPastExpiry(request)) await expireSingleRequest(requestId);

  const offers = await donationOfferRepository.findOffersByRequest(requestId);
  offers.sort((left, right) => {
    const statusOrder = Number(right.status === 'pending') - Number(left.status === 'pending');
    if (statusOrder) return statusOrder;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  return { offers: offers.map(toPublicOffer) };
};

exports.acceptOfferLogic = async (requestId, offerId, userId) => {
  const settings = await SystemSettings.getCached();
  const session = await mongoose.startSession();
  let request;
  let offer;
  let safeHub;
  let item;
  let rejectedOffers = [];

  try {
    session.startTransaction();
    const now = new Date();

    request = await DonationRequest.findOneAndUpdate(
      {
        _id: requestId,
        requester: userId,
        status: 'active',
        expiresAt: { $gt: now },
      },
      { $set: { status: 'processing' } },
      { new: true, session, runValidators: true }
    );

    if (!request) {
      throw new AppError(
        'الطلب غير متاح أو تمت معالجته من طرف آخر',
        409,
        'REQUEST_NOT_AVAILABLE'
      );
    }

    offer = await DonationOffer.findOneAndUpdate(
      { _id: offerId, request: requestId, status: 'pending' },
      { $set: { status: 'accepted' } },
      { new: true, session, runValidators: true }
    ).lean();

    if (!offer)
      throw new AppError('العرض غير متاح أو تمت معالجته مسبقاً', 409, 'OFFER_NOT_AVAILABLE');

    const [requesterUser, donor, hub, requesterBookings, donorActiveItems, pendingOffers] = await Promise.all([
      User.findOne({
        _id: userId,
        isVerified: true,
        isBanned: { $ne: true },
        isFrozen: { $ne: true },
      }).select('_id trustLevel').session(session).lean(),
      User.findOne({
        _id: offer.donor,
        isVerified: true,
        isBanned: { $ne: true },
        isFrozen: { $ne: true },
      }).select('_id name trustLevel phoneVerified').session(session).lean(),
      offer.safeHub
        ? SafeHub.findOne({
            _id: offer.safeHub,
            isActive: { $ne: false },
          }).select('_id name city address').session(session).lean()
        : Promise.resolve(null),
      Item.countDocuments({ bookedBy: userId, status: 'محجوز' }).session(session),
      Item.countDocuments({ donor: offer.donor, status: { $in: ['متاح', 'محجوز'] } }).session(session),
      DonationOffer.find({
        request: requestId,
        status: 'pending',
        _id: { $ne: offerId },
      }).select('_id donor cloudinaryId').session(session).lean(),
    ]);

    if (!requesterUser || (requesterUser.trustLevel ?? 0) < getMinTrustLevel(settings))
      throw new AppError('صاحب الطلب لم يعد مؤهلاً لإتمامه', 403, 'REQUESTER_NOT_ELIGIBLE');
    if (!donor)
      throw new AppError('المتبرع لم يعد مؤهلاً لإتمام العرض', 409, 'OFFER_DONOR_UNAVAILABLE');
    if ((donor.trustLevel ?? 0) < (settings.minTrustLevelForDonating ?? 1))
      throw new AppError('المتبرع لم يعد مؤهلاً لإتمام العرض', 409, 'OFFER_DONOR_UNAVAILABLE');
    if (isPhoneVerificationEnabled() && !donor.phoneVerified && (donor.trustLevel ?? 1) < 2)
      throw new AppError('المتبرع لم يعد مؤهلاً لإتمام العرض', 409, 'OFFER_DONOR_UNAVAILABLE');
    if (settings.requireHubForBooking && !offer.safeHub)
      throw new AppError('يجب تحديد نقطة تسليم لهذا العرض', 409, 'SAFE_HUB_REQUIRED');
    if (offer.safeHub && !hub)
      throw new AppError('نقطة التسليم لم تعد متاحة', 409, 'SAFE_HUB_UNAVAILABLE');

    const maxBookings = settings.maxBookingsPerUser ?? DEFAULT_BOOKINGS_LIMIT;
    if (requesterBookings >= maxBookings) {
      throw new AppError(
        `وصلت للحد الأقصى (${maxBookings} حجوزات نشطة)`,
        429,
        'MAX_BOOKINGS_REACHED'
      );
    }

    const donorItemLimit = (donor.trustLevel ?? 1) >= 2
      ? (settings.maxActiveDonationsLevel2Plus ?? 4)
      : (settings.maxActiveDonationsPerUser ?? 2);
    if (donorActiveItems >= donorItemLimit) {
      throw new AppError(
        'المتبرع وصل حالياً إلى الحد الأقصى للأغراض النشطة',
        409,
        'DONOR_ACTIVE_ITEMS_LIMIT'
      );
    }

    safeHub = hub;
    rejectedOffers = pendingOffers;

    [item] = await Item.create([{
      title: request.title,
      description: offer.description || request.description,
      category: request.category,
      location: request.location,
      condition: offer.condition,
      safeHub: hub?._id ?? null,
      donor: donor._id,
      imageUrl: offer.imageUrl,
      cloudinaryId: offer.cloudinaryId,
      linkedRequestId: requestId,
      status: 'محجوز',
      bookedBy: userId,
      bookedAt: now,
      recipientConfirmed: false,
      donorConfirmed: false,
      reminderSent: false,
    }], { session });

    if (rejectedOffers.length) {
      await DonationOffer.updateMany(
        { request: requestId, status: 'pending', _id: { $ne: offerId } },
        { $set: { status: 'rejected' } },
        { session, runValidators: true }
      );
    }

    const fulfilled = await DonationRequest.updateOne(
      { _id: requestId, status: 'processing' },
      { $set: { status: 'fulfilled', fulfilledByItem: item._id } },
      { session, runValidators: true }
    );
    if (fulfilled.modifiedCount !== 1)
      throw new AppError('تعذر إتمام قبول العرض', 409, 'REQUEST_FULFILLMENT_CONFLICT');

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    if (isTransactionConflict(error)) {
      throw new AppError(
        'تمت معالجة الطلب من طرف آخر؛ حدّث الصفحة',
        409,
        'REQUEST_FULFILLMENT_CONFLICT'
      );
    }
    throw error;
  } finally {
    await endSession(session);
  }

  queueBackground('acceptDonationOffer', async () => {
    await cleanupOfferImages(rejectedOffers, 'acceptDonationOffer');
    await Promise.allSettled([
      notifyUser(offer.donor, {
        type: 'offer_accepted',
        title: 'تم قبول عرضك! 🎉',
        body: safeHub
          ? `اختارك صاحب الطلب — توجّه إلى ${safeHub.name} لإتمام التسليم.`
          : 'اختارك صاحب الطلب — تواصل معه للاتفاق على طريقة التسليم.',
        itemId: item._id,
        actionUrl: `/items/${item._id}`,
        metadata: {
          requestId: request._id.toString(),
          offerId: offer._id.toString(),
        },
      }),
      notifyRejectedOffers(rejectedOffers, request, 'another_offer'),
    ]);
  });

  return {
    msg: 'تم اختيار المتبرع وحجز الغرض بنجاح 🎉',
    itemId: item._id.toString(),
  };
};

exports.rejectOfferLogic = async (requestId, offerId, userId) => {
  const session = await mongoose.startSession();
  let request;
  let offer;

  try {
    session.startTransaction();
    request = await DonationRequest.findOne({
      _id: requestId,
      requester: userId,
      status: 'active',
      expiresAt: { $gt: new Date() },
    }).session(session).lean();

    if (!request)
      throw new AppError('الطلب غير متاح لمعالجة العروض', 409, 'REQUEST_NOT_AVAILABLE');

    offer = await DonationOffer.findOneAndUpdate(
      { _id: offerId, request: requestId, status: 'pending' },
      { $set: { status: 'rejected' } },
      { new: true, session, runValidators: true }
    ).lean();

    if (!offer)
      throw new AppError('العرض غير متاح أو تمت معالجته مسبقاً', 409, 'OFFER_NOT_AVAILABLE');

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    if (isTransactionConflict(error))
      throw new AppError('تمت معالجة العرض من طرف آخر', 409, 'OFFER_NOT_AVAILABLE');
    throw error;
  } finally {
    await endSession(session);
  }

  queueBackground('rejectDonationOffer', async () => {
    await cleanupOfferImages([offer], 'rejectDonationOffer');
    await notifyUser(offer.donor, {
      type: 'offer_rejected',
      title: 'لم يتم اختيار عرضك',
      body: `لم يعتمد صاحب طلب "${request.title}" عرضك هذه المرة — شكراً لمبادرتك.`,
      actionUrl: `/donation-requests/${request._id}`,
      metadata: {
        requestId: request._id.toString(),
        offerId: offer._id.toString(),
      },
    });
  });

  return { msg: 'تم رفض العرض' };
};

exports.withdrawOfferLogic = async (requestId, offerId, donorId) => {
  const session = await mongoose.startSession();
  let request;
  let offer;

  try {
    session.startTransaction();
    request = await DonationRequest.findOne({
      _id: requestId,
      status: 'active',
      expiresAt: { $gt: new Date() },
    }).session(session).lean();

    if (!request)
      throw new AppError('الطلب لم يعد نشطاً', 409, 'REQUEST_NOT_AVAILABLE');

    offer = await DonationOffer.findOneAndUpdate(
      { _id: offerId, request: requestId, donor: donorId, status: 'pending' },
      { $set: { status: 'withdrawn' } },
      { new: true, session, runValidators: true }
    ).lean();

    if (!offer)
      throw new AppError('العرض غير متاح للسحب', 409, 'OFFER_NOT_WITHDRAWABLE');

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    if (isTransactionConflict(error))
      throw new AppError('تمت معالجة العرض من طرف آخر', 409, 'OFFER_NOT_WITHDRAWABLE');
    throw error;
  } finally {
    await endSession(session);
  }

  queueBackground('withdrawDonationOffer', async () => {
    await cleanupOfferImages([offer], 'withdrawDonationOffer');
    await notifyUser(request.requester, {
      type: 'offer_withdrawn',
      title: 'تم سحب عرض تبرع',
      body: `سحب أحد المتبرعين عرضه لطلب "${request.title}".`,
      actionUrl: `/donation-requests/${request._id}`,
      metadata: {
        requestId: request._id.toString(),
        offerId: offer._id.toString(),
      },
    });
  });

  return { msg: 'تم سحب العرض بنجاح' };
};

exports.getRequestByIdLogic = async (requestId, viewerId = null, viewerRole = 'user') => {
  let request = await donationRequestRepository.findRequestByIdWithItem(requestId);
  if (!request)
    throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');

  if (isPastExpiry(request)) {
    await expireSingleRequest(requestId);
    request = await donationRequestRepository.findRequestByIdWithItem(requestId);
  }

  const isOwner = idsEqual(request.requester, viewerId);
  const isAdmin = isAdminRole(viewerRole);
  const viewerOffer = viewerId && !isOwner && !isAdmin
    ? await donationOfferRepository.findViewerOffer(requestId, viewerId)
    : null;
  const canViewFulfilledItem = Boolean(
    isOwner || isAdmin || viewerOffer?.status === 'accepted'
  );

  return {
    ...toEffectivePublicRequest(request, {
      includeFulfilledItem: canViewFulfilledItem,
    }),
    viewerOffer: viewerOffer ? {
      _id: viewerOffer._id,
      status: viewerOffer.status,
      createdAt: viewerOffer.createdAt,
    } : null,
  };
};

exports.expireDonationRequestsLogic = async (now = new Date(), options = {}) => {
  const expiredIds = await donationRequestRepository.findExpiredActiveIds({
    now,
    requester: options.requester ?? null,
    limit: Math.min(Math.max(Number(options.limit) || 200, 1), 1000),
  });

  let expiredCount = 0;
  for (const entry of expiredIds) {
    const expired = await expireSingleRequest(entry._id, now);
    if (expired) expiredCount += 1;
  }

  return { expiredCount };
};

exports._private = {
  cleanupOfferImages,
  expireSingleRequest,
  isAdminRole,
  isPastExpiry,
  toEffectivePublicRequest,
};
