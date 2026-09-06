import mongoose from 'mongoose';
import SystemSettings from '../models/SystemSettings.js';
import User from '../models/User.js';
import Item from '../models/Item.js';
import SafeHub from '../models/SafeHub.js';
import DonationRequest from '../models/DonationRequest.js';
import DonationOffer from '../models/DonationOffer.js';
import donationRequestRepository from '../repositories/donationRequestRepository.js';
import donationOfferRepository from '../repositories/donationOfferRepository.js';
import { toPublicRequest } from '../dtos/donationRequestDto.js';
import { toPublicOffer } from '../dtos/donationOfferDto.js';
import AppError from '../utils/AppError.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/uploadToCloudinary.js';
import { validateImageFile } from '../utils/imageValidation.js';
import notifyUser from '../utils/notifyUser.js';
import { isPhoneVerificationEnabled } from '../middlewares/phoneVerificationFeature.js';
import type { ClientSession } from 'mongoose';
import type { EntityId, UploadedFile } from './serviceTypes.js';
import { getErrorDetails, getErrorMessage, hasErrorCode } from './serviceTypes.js';

const DEFAULT_REQUEST_LIMIT = 1;
const DEFAULT_REQUEST_EXPIRY_DAYS = 30;
const DEFAULT_PENDING_OFFERS_LIMIT = 5;
const DEFAULT_BOOKINGS_LIMIT = 3;

type EffectiveRequestOptions = {
  now?: Date;
  includeFulfilledItem?: boolean;
};

type DonationRequestQuery = {
  page?: string | number;
  limit?: string | number;
  mine?: string | boolean;
  category?: string;
  location?: string;
  urgency?: string;
};

type RequestSettings = {
  minTrustLevelForRequests?: number;
  maxActiveRequestsPerMonth?: number;
  categories?: string[];
  locations?: string[];
  requestExpiryDays?: number;
  maxPageSize?: number;
  minTrustLevelForDonating?: number;
  requireHubForBooking?: boolean;
  maxPendingOffersPerDonor?: number;
  maxBookingsPerUser?: number;
  maxActiveDonationsLevel2Plus?: number;
  maxActiveDonationsPerUser?: number;
};

type EntityReference = EntityId | { _id?: EntityId | null };
type RequestLike = {
  _id: EntityId;
  title: string;
  status?: string;
  expiresAt?: string | Date | null;
  requester?: EntityReference | null;
  toObject?: () => RequestLike;
  [key: string]: unknown;
};
type OfferLike = {
  _id: EntityId;
  donor?: EntityReference | null;
  safeHub?: EntityReference | null;
  cloudinaryId?: string | null;
  status?: string;
  createdAt?: string | Date;
  [key: string]: unknown;
};
export type RequestCreateInput = {
  title: string;
  description?: string;
  category: string;
  location: string;
  urgency?: 'low' | 'medium' | 'high';
};
export type OfferInput = {
  safeHub?: EntityId;
  condition: string;
  description?: string;
};
type BackgroundTask = () => void | Promise<unknown>;

const asRequestSettings = (settings: unknown): RequestSettings => (
  typeof settings === 'object' && settings !== null ? settings : {}
);

const getMinTrustLevel = (settings: RequestSettings) => settings.minTrustLevelForRequests ?? 2;
const getObjectId = (value: EntityReference | null | undefined): EntityId | undefined => {
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return value._id ?? undefined;
  }
  return value as EntityId | undefined;
};
const idsEqual = (
  left: EntityReference | null | undefined,
  right: EntityReference | null | undefined
) => {
  const leftId = getObjectId(left);
  const rightId = getObjectId(right);
  return Boolean(leftId && rightId && leftId.toString() === rightId.toString());
};
const isAdminRole = (role: string) => ['admin', 'super_admin'].includes(role);

const isPastExpiry = (request: Pick<RequestLike, 'status' | 'expiresAt'>, now = new Date()) => {
  if (request?.status !== 'active' || !request.expiresAt) return false;
  const expiresAt = new Date(request.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
};

const toEffectivePublicRequest = (
  request: RequestLike,
  options: EffectiveRequestOptions = {}
) => {
  const value = request?.toObject ? request.toObject() : { ...request };
  const now = options.now ?? new Date();
  if (isPastExpiry(value, now)) value.status = 'expired';
  return toPublicRequest(value, {
    includeFulfilledItem: Boolean(options.includeFulfilledItem),
  });
};

const queueBackground = (label: string, task: BackgroundTask) => {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => console.warn(
        `[${label}] فشلت المهمة الخلفية:`,
        getErrorMessage(error)
      ));
  });
};

const uniqueById = (offers: OfferLike[]) => {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const id = getObjectId(offer.donor)?.toString();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const cleanupOfferImages = async (offers: OfferLike[], label: string) => {
  const images = offers.filter((offer) => offer?._id && offer.cloudinaryId);
  if (!images.length) return;

  const results = await Promise.allSettled(images.map(async (offer) => {
    const cloudinaryId = offer.cloudinaryId;
    if (!cloudinaryId) return;
    await deleteFromCloudinary(cloudinaryId);
    await DonationOffer.updateOne(
      { _id: offer._id, cloudinaryId },
      { $set: { imageUrl: null, cloudinaryId: null } }
    );
  }));

  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) {
    console.warn(`[${label}] تعذر تنظيف ${failed} صورة/صور من Cloudinary`);
  }
};

const endSession = async (session: ClientSession) => {
  try {
    await session.endSession();
  } catch (error: unknown) {
    console.warn('[DonationRequest] تعذر إنهاء MongoDB session:', getErrorMessage(error));
  }
};

const isTransactionConflict = (error: unknown) => {
  const details = getErrorDetails(error);
  const hasErrorLabel = typeof details.hasErrorLabel === 'function'
    ? details.hasErrorLabel as (label: string) => boolean
    : null;
  return [11000, 112, 251].includes(Number(details.code))
    || Boolean(hasErrorLabel?.('TransientTransactionError'))
    || Boolean(hasErrorLabel?.('UnknownTransactionCommitResult'));
};

const normalizeOfferDuplicate = (error: unknown) => {
  if (!hasErrorCode(error, 11000)) return error;
  return new AppError(
    'لقد قدّمت عرضاً لهذا الطلب مسبقاً ⏳',
    409,
    'ALREADY_OFFERED'
  );
};

const notifyRejectedOffers = async (
  offers: OfferLike[],
  request: RequestLike,
  reason: 'expired' | 'another_offer'
) => {
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

const expireSingleRequest = async (requestId: EntityId, now = new Date()) => {
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

export const createRequestLogic = async (body: RequestCreateInput, userId: EntityId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel isVerified').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (!user.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  const requestSettings = asRequestSettings(settings);
  const minLevel = getMinTrustLevel(requestSettings);
  if ((user.trustLevel ?? 1) < minLevel) {
    throw new AppError(
      `يجب أن يكون مستوى حسابك Level ${minLevel} على الأقل لنشر طلب تبرع 🌟`,
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const maxRequests = requestSettings.maxActiveRequestsPerMonth ?? DEFAULT_REQUEST_LIMIT;
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

  if (!requestSettings.categories?.includes(body.category))
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');

  if (requestSettings.locations?.length && !requestSettings.locations.includes(body.location))
    throw new AppError(`المنطقة "${body.location}" غير مدعومة`, 400, 'INVALID_LOCATION');

  const expiresAt = new Date();
  expiresAt.setDate(
    expiresAt.getDate() + (requestSettings.requestExpiryDays ?? DEFAULT_REQUEST_EXPIRY_DAYS)
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
    request: toEffectivePublicRequest(request as unknown as RequestLike),
  };
};

export const getDonationRequestsLogic = async (
  query: DonationRequestQuery,
  userId: EntityId | null = null
) => {
  const page = Math.max(1, Number.parseInt(String(query.page ?? ''), 10) || 1);
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit = Math.min(
    maxPageSize,
    Math.max(1, Number.parseInt(String(query.limit ?? ''), 10) || 10)
  );
  const skip = (page - 1) * limit;
  const mine = String(query.mine).toLowerCase() === 'true';
  const filter: Record<string, unknown> = {};

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
    requests: requests.map((request: RequestLike) => toEffectivePublicRequest(request, {
      includeFulfilledItem: mine,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
};

export const cancelRequestLogic = async (requestId: EntityId, userId: EntityId) => {
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

export const getMyRequestsLogic = async (userId: EntityId) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [requests, settings, usedThisMonth] = await Promise.all([
    donationRequestRepository.findUserRequests(userId),
    SystemSettings.getCached(),
    donationRequestRepository.countAllMonthlyRequests({ userId, month: currentMonth }),
  ]);
  const max = settings.maxActiveRequestsPerMonth ?? DEFAULT_REQUEST_LIMIT;

  return {
    requests: requests.map((request: RequestLike) => toEffectivePublicRequest(request, {
      includeFulfilledItem: true,
    })),
    quota: {
      used: usedThisMonth,
      max,
      remaining: Math.max(0, max - usedThisMonth),
    },
  };
};

export const submitOfferLogic = async (
  requestId: EntityId,
  donorId: EntityId,
  body: OfferInput,
  file?: UploadedFile
) => {
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
      } catch (cleanupError: unknown) {
        console.warn(
          '[submitDonationOffer] تعذر تنظيف الصورة بعد فشل الحفظ:',
          getErrorMessage(cleanupError)
        );
      }
    }
    throw normalizeOfferDuplicate(error);
  } finally {
    if (session) await endSession(session);
  }
};

export const getOffersLogic = async (requestId: EntityId, userId: EntityId) => {
  const request = await DonationRequest.findById(requestId)
    .select('requester status expiresAt')
    .lean();

  if (!request)
    throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');
  if (!idsEqual(request.requester, userId))
    throw new AppError('غير مصرح لك برؤية هذه العروض 🚫', 403, 'FORBIDDEN');

  if (isPastExpiry(request)) await expireSingleRequest(requestId);

  const offers = await donationOfferRepository.findOffersByRequest(requestId);
  offers.sort((left: OfferLike, right: OfferLike) => {
    const statusOrder = Number(right.status === 'pending') - Number(left.status === 'pending');
    if (statusOrder) return statusOrder;
    return new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime();
  });

  return { offers: offers.map(toPublicOffer) };
};

export const acceptOfferLogic = async (
  requestId: EntityId,
  offerId: EntityId,
  userId: EntityId
) => {
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

    if (!requesterUser || (requesterUser.trustLevel ?? 0) < getMinTrustLevel(asRequestSettings(settings)))
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
      notifyRejectedOffers(rejectedOffers, request as unknown as RequestLike, 'another_offer'),
    ]);
  });

  return {
    msg: 'تم اختيار المتبرع وحجز الغرض بنجاح 🎉',
    itemId: item._id.toString(),
  };
};

export const rejectOfferLogic = async (
  requestId: EntityId,
  offerId: EntityId,
  userId: EntityId
) => {
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

export const withdrawOfferLogic = async (
  requestId: EntityId,
  offerId: EntityId,
  donorId: EntityId
) => {
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

export const getRequestByIdLogic = async (
  requestId: EntityId,
  viewerId: EntityId | null = null,
  viewerRole = 'user'
) => {
  let request = await donationRequestRepository.findRequestByIdWithItem(requestId);
  if (!request)
    throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');

  if (isPastExpiry(request)) {
    await expireSingleRequest(requestId);
    request = await donationRequestRepository.findRequestByIdWithItem(requestId);
    if (!request) throw new AppError('الطلب غير موجود', 404, 'REQUEST_NOT_FOUND');
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
    ...toEffectivePublicRequest(request as unknown as RequestLike, {
      includeFulfilledItem: canViewFulfilledItem,
    }),
    viewerOffer: viewerOffer ? {
      _id: viewerOffer._id,
      status: viewerOffer.status,
      createdAt: viewerOffer.createdAt,
    } : null,
  };
};

export const expireDonationRequestsLogic = async (
  now = new Date(),
  options: { requester?: unknown; limit?: number } = {}
) => {
  const expiredIds = await donationRequestRepository.findExpiredActiveIds({
    now,
    requester: typeof options.requester === 'string' || options.requester instanceof mongoose.Types.ObjectId
      ? options.requester
      : null,
    limit: Math.min(Math.max(Number(options.limit) || 200, 1), 1000),
  });

  let expiredCount = 0;
  for (const entry of expiredIds) {
    const expired = await expireSingleRequest(entry._id, now);
    if (expired) expiredCount += 1;
  }

  return { expiredCount };
};

export const _private = {
  cleanupOfferImages,
  expireSingleRequest,
  isAdminRole,
  isPastExpiry,
  toEffectivePublicRequest,
};

export default { createRequestLogic, getDonationRequestsLogic, cancelRequestLogic, getMyRequestsLogic, submitOfferLogic, getOffersLogic, acceptOfferLogic, rejectOfferLogic, withdrawOfferLogic, getRequestByIdLogic, expireDonationRequestsLogic, _private };
