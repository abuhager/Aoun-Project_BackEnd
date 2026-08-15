// services/donationRequestService.js
// ✅ PATCHED v3 — تعديل شروط توثيق الهاتف للمستخدمين ذوي Level 2 فما فوق
// FIX [DUP-01]: نقل require('mongoose') للأعلى بدل داخل كل دالة
// FIX [OFFERS-01]: getOffersLogic يتحقق من حالة الطلب قبل إرجاع العروض
// FIX [SESSION-01]: session.endSession() في finally لكل الدوال
// FIX [PHONE-BYPASS-LVL2]: تخطي فحص الهاتف لمن يمتلك Level 2 فما فوق

const mongoose                   = require('mongoose');
const SystemSettings             = require('../models/SystemSettings');
const User                       = require('../models/User');
const donationRequestRepository  = require('../repositories/donationRequestRepository');
const AppError                   = require('../utils/AppError');
const Item                       = require('../models/Item');
const SafeHub                    = require('../models/SafeHub');
const { uploadToCloudinary }     = require('../utils/uploadToCloudinary');
const notifyUser                 = require('../utils/notifyUser');
const DonationRequest            = require('../models/DonationRequest');
const donationOfferRepository    = require('../repositories/donationOfferRepository');
const DonationOffer              = require('../models/DonationOffer');
const { validateImageFile }      = require('../utils/imageValidation');
const { getIO }                  = require('../socket');

const getMinTrustLevel = (s) => s.minTrustLevelForRequests ?? 2;

// ─────────────────────────────────────────────────────────────────────────────
// 1. إنشاء طلب تبرع جديد
// ─────────────────────────────────────────────────────────────────────────────
exports.createRequestLogic = async (body, userId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel isVerified').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user?.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  // ✅ الشرط الصريح: إنشاء طلب التبرع محصور فقط لمن يمتلك Level 2 فما فوق
  const userLevel = user.trustLevel ?? 1;
  if (userLevel < 2) {
    throw new AppError(
      'يجب أن يكون مستوى حسابك Level 2 على الأقل لتتمكن من نشر طلب تبرع 🌟',
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  const totalThisMonth = await donationRequestRepository.countAllMonthlyRequests({
    userId,
    month: currentMonth,
  });
  if (totalThisMonth >= settings.maxActiveRequestsPerMonth)
    throw new AppError(
      `لا يمكنك نشر أكثر من ${settings.maxActiveRequestsPerMonth} طلب في الشهر الواحد (بما فيها الملغية)`,
      429,
      'MONTHLY_LIMIT_EXCEEDED'
    );

  if (!settings.categories?.includes(body.category))
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');

  if (settings.locations?.length && !settings.locations.includes(body.location))
    throw new AppError(`المنطقة "${body.location}" غير مدعومة`, 400, 'INVALID_LOCATION');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (settings.requestExpiryDays ?? 30));

  const request = await donationRequestRepository.createRequest({
    title:       body.title?.trim(),
    description: body.description?.trim(),
    category:    body.category,
    location:    body.location?.trim(),
    urgency:     body.urgency ?? 'medium',
    requester:   userId,
    month:       currentMonth,
    expiresAt,
    status:      'active',
  });

  return { msg: 'تم نشر طلبك بنجاح 🎉', request };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. جلب قائمة طلبات التبرع
// ─────────────────────────────────────────────────────────────────────────────
exports.getDonationRequestsLogic = async (query, userId) => {
  const page        = Math.max(1, parseInt(query.page, 10) || 1);
  const settings    = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit       = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip        = (page - 1) * limit;

  const mine   = String(query.mine).toLowerCase() === 'true';
  const filter = {};

  const allowedCategories = settings.categories ?? [];
  const allowedLocations  = settings.locations  ?? [];

  if (query.category && query.category !== 'all') {
    if (allowedCategories.includes(query.category))
      filter.category = query.category;
  }
  if (query.location && query.location !== 'all') {
    if (!allowedLocations.length || allowedLocations.includes(query.location))
      filter.location = query.location;
  }
  if (query.urgency && ['low', 'medium', 'high'].includes(query.urgency))
    filter.urgency = query.urgency;

  if (mine) {
    filter.requester = userId;
  } else {
    filter.status    = 'active';
    filter.expiresAt = { $gt: new Date() };
  }

  const [requests, total] = await Promise.all([
    donationRequestRepository.findRequests({ filter, skip, limit }),
    donationRequestRepository.countRequests(filter),
  ]);

  return { requests, total, page, pages: Math.ceil(total / limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. إلغاء طلب تبرع
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelRequestLogic = async (requestId, userId) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const request = await DonationRequest.findOneAndUpdate(
      { _id: requestId, requester: userId, status: 'active' },
      { $set: { status: 'cancelled' } },
      { new: true, session }
    ).lean();

    if (!request)
      throw new AppError(
        'الطلب غير موجود أو لا تملك صلاحية إلغائه',
        404,
        'REQUEST_NOT_FOUND_OR_FORBIDDEN'
      );

    const cancelledOffers = await DonationOffer.find(
      { request: requestId, status: 'pending' },
      { donor: 1 },
      { session, lean: true }
    );

    if (cancelledOffers.length > 0) {
      await DonationOffer.updateMany(
        { request: requestId, status: 'pending' },
        { $set: { status: 'cancelled_by_requester' } },
        { session }
      );
    }

    await session.commitTransaction();

    if (cancelledOffers.length > 0) {
      setImmediate(async () => {
        try {
          const io = getIO();
          await Promise.allSettled(
            cancelledOffers.map(async (offer) => {
              io.to(`user_${offer.donor}`).emit('offer:request_cancelled', {
                type:      'REQUEST_CANCELLED',
                requestId: request._id,
                message:   'أُلغي الطلب من صاحبه — شكراً لتبرعك 🙏',
              });
              await notifyUser(offer.donor, {
                type:  'request_cancelled_by_requester',
                title: 'تم إلغاء الطلب',
                body:  'أُلغي طلب كنت قد قدّمت عليه عرضاً — شكراً لتجاوبك',
              });
            })
          );
        } catch (err) {
          console.warn('[cancelRequest] فشل الإشعارات:', err.message);
        }
      });
    }

    return { msg: 'تم إلغاء الطلب ✅' };

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    try { session.endSession(); } catch (_) {}
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. جلب طلباتي مع الـ Quota المتبقية
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyRequestsLogic = async (userId) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const now          = new Date();

  const [requests, settings, usedThisMonth] = await Promise.all([
    donationRequestRepository.findUserRequests(userId),
    SystemSettings.getCached(),
    donationRequestRepository.countActiveMonthlyRequests({ userId, month: currentMonth, now }),
  ]);

  return {
    requests,
    quota: {
      used:      usedThisMonth,
      max:       settings.maxActiveRequestsPerMonth,
      remaining: Math.max(0, settings.maxActiveRequestsPerMonth - usedThisMonth),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. المتبرع يقدّم عرضاً
// ─────────────────────────────────────────────────────────────────────────────
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

  if (request.requester._id.toString() === donorId)
    throw new AppError('لا يمكنك التبرع لطلبك الخاص 🚫', 400, 'CANNOT_OFFER_OWN_REQUEST');

  if (!donor.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  // يتطلب توثيق الهاتف فقط إذا كان المستوى أقل من 2
  if (!donor.phoneVerified && (donor.trustLevel ?? 1) < 2)
    throw new AppError(
      'يجب التحقق من رقم هاتفك أولاً للتبرع 📱',
      403,
      'PHONE_NOT_VERIFIED'
    );

  const minLevel = settings.minTrustLevelForDonating ?? 1;
  if (donor.trustLevel < minLevel)
    throw new AppError(`يلزم Level ${minLevel} على الأقل للتبرع`, 403, 'INSUFFICIENT_TRUST_LEVEL');

  const [alreadyOffered, safeHub, pendingOffersCount] = await Promise.all([
    donationOfferRepository.existsByRequestAndDonor(requestId, donorId),
    SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean(),
    donationOfferRepository.countPendingOffersByDonor(donorId),
  ]);

  if (alreadyOffered)
    throw new AppError('لقد قدّمت عرضاً لهذا الطلب مسبقاً ⏳', 409, 'ALREADY_OFFERED');

  if (!safeHub)
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');

  const maxPendingOffers = settings.maxPendingOffersPerDonor ?? 5;
  if (pendingOffersCount >= maxPendingOffers)
    throw new AppError(
      `لديك ${pendingOffersCount} عرض معلّق — انتظر حتى يُعالَج بعضها`,
      429,
      'MAX_PENDING_OFFERS_REACHED'
    );

  let imageUrl = null, cloudinaryId = null;
  if (file) {
    validateImageFile(file);
    const uploaded = await uploadToCloudinary(file.buffer);
    imageUrl     = uploaded.secure_url;
    cloudinaryId = uploaded.public_id;
  }

  const offer = await donationOfferRepository.createOffer({
    request:      requestId,
    donor:        donorId,
    safeHub:      body.safeHub,
    condition:    body.condition,
    description:  body.description?.trim() || null,
    imageUrl,
    cloudinaryId,
    status:       'pending',
  });

  setImmediate(async () => {
    try {
      getIO().to(`user_${request.requester._id}`).emit('request:new_offer', {
        type:      'NEW_OFFER',
        requestId: request._id,
        offerId:   offer._id,
        donorName: donor.name,
        title:     request.title,
        message:   `${donor.name} يريد التبرع بـ "${request.title}" 🎁`,
      });
      await notifyUser(request.requester._id, {
        type:     'request_new_offer',
        title:    'عرض تبرع جديد! 🎁',
        body:     `${donor.name} عرض التبرع بـ "${request.title}" — راجع العروض واختر`,
        metadata: { requestId: request._id.toString(), offerId: offer._id.toString() },
      });
    } catch (err) {
      console.warn('[submitOffer] فشل الإشعار:', err.message);
    }
  });

  return { msg: 'تم إرسال عرضك لصاحب الطلب بنجاح 🎉', offerId: offer._id };
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. جلب العروض على طلب معين (لصاحب الطلب فقط)
// ─────────────────────────────────────────────────────────────────────────────
exports.getOffersLogic = async (requestId, userId) => {
  const request = await DonationRequest.findById(requestId)
    .select('requester status')
    .lean();

  if (!request)
    throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');

  if (request.requester.toString() !== userId)
    throw new AppError('غير مصرح لك برؤية هذه العروض 🚫', 403, 'FORBIDDEN');

  const closedStatuses = ['cancelled', 'fulfilled'];
  if (closedStatuses.includes(request.status))
    throw new AppError(
      `لا يمكن عرض العروض — الطلب في حالة "${request.status}"`,
      400,
      'REQUEST_CLOSED'
    );

  const offers = await donationOfferRepository.findOffersByRequest(requestId);
  return { offers };
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. صاحب الطلب يختار عرضاً ← Transaction كاملة
// ─────────────────────────────────────────────────────────────────────────────
exports.acceptOfferLogic = async (requestId, offerId, userId) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const request = await DonationRequest.findOneAndUpdate(
      { _id: requestId, requester: userId, status: 'active' },
      { $set: { status: 'processing' } },
      { new: false, session }
    );

    if (!request)
      throw new AppError(
        'الطلب غير موجود أو جارٍ معالجته من طرف آخر',
        409,
        'REQUEST_NOT_AVAILABLE'
      );

    const offer = await DonationOffer.findOneAndUpdate(
      { _id: offerId, request: requestId, status: 'pending' },
      { $set: { status: 'accepted' } },
      { new: true, session }
    ).populate('donor safeHub');

    if (!offer)
      throw new AppError(
        'العرض غير موجود أو تمت معالجته مسبقاً',
        409,
        'OFFER_NOT_AVAILABLE'
      );

    const [item] = await Item.create(
      [{
        title:           request.title,
        description:     offer.description || request.description,
        category:        request.category,
        location:        request.location,
        condition:       offer.condition,
        safeHub:         offer.safeHub._id,
        donor:           offer.donor._id,
        imageUrl:        offer.imageUrl,
        cloudinaryId:    offer.cloudinaryId,
        linkedRequestId: requestId,
        status:          'محجوز',
        bookedBy:        userId,
        bookedAt:        new Date(),
      }],
      { session }
    );

    await DonationOffer.updateMany(
      { request: requestId, status: 'pending', _id: { $ne: offerId } },
      { $set: { status: 'rejected' } },
      { session }
    );

    await DonationRequest.findByIdAndUpdate(
      requestId,
      { $set: { status: 'fulfilled', fulfilledByItem: item._id } },
      { session }
    );

    await session.commitTransaction();

    setImmediate(async () => {
      try {
        const io = getIO();

        io.to(`user_${offer.donor._id}`).emit('offer:accepted', {
          type:      'OFFER_ACCEPTED',
          requestId: request._id,
          offerId,
          itemId:    item._id.toString(),
          message:   `تم اختيارك! توجّه إلى ${offer.safeHub.name} لإتمام التسليم 🤝`,
        });

        await notifyUser(offer.donor._id, {
          type:   'offer_accepted',
          title:  'تم قبول عرضك! 🎉',
          body:   `صاحب الطلب اختارك — توجّه إلى ${offer.safeHub.name} وأكّد التسليم`,
          itemId: item._id.toString(),
        });

        const rejectedOffers = await DonationOffer.find({
          request: requestId,
          status:  'rejected',
          _id:     { $ne: offerId },
        }).select('donor').lean();

        await Promise.allSettled(
          rejectedOffers.map(async (r) => {
            io.to(`user_${r.donor}`).emit('offer:rejected', {
              type:      'OFFER_REJECTED',
              requestId: request._id,
              message:   'اختار صاحب الطلب شخصاً آخر هذه المرة 🙏',
            });
            await notifyUser(r.donor, {
              type:  'offer_rejected',
              title: 'لم يتم اختيارك هذه المرة',
              body:  'شكراً لتبرعك — حاول مرة أخرى مع طلبات أخرى 💪',
            });
          })
        );
      } catch (err) {
        console.warn('[acceptOffer] فشل الإشعارات:', err.message);
      }
    });

    return { msg: 'تم اختيار المتبرع بنجاح 🎉', itemId: item._id.toString() };

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    try { session.endSession(); } catch (_) {}
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. جلب طلب بحسب الـ ID
// ─────────────────────────────────────────────────────────────────────────────
exports.getRequestByIdLogic = async (requestId) => {
  const request = await donationRequestRepository.findRequestByIdWithItem(requestId);
  if (!request)
    throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');
  return request;
};
