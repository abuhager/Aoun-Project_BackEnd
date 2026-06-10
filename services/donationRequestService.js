// services/donationRequestService.js
const SystemSettings             = require('../models/SystemSettings');
const User                       = require('../models/User');
const donationRequestRepository  = require('../repositories/donationRequestRepository');
const AppError                   = require('../utils/AppError');
const Item                       = require('../models/Item');
const SafeHub                    = require('../models/SafeHub');
const { uploadToCloudinary }     = require('../utils/uploadToCloudinary');
const notifyUser                 = require('../utils/notifyUser');

// ✅ منفصلتان: إنشاء الطلب vs الاستجابة (التبرع)
const getMinTrustLevel           = (s) => s.minTrustLevelForRequests  ?? 2;
const getMinTrustLevelForDonating = (s) => s.minTrustLevelForDonating ?? 1;

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

  const minTrustLevel = getMinTrustLevel(settings);
  if ((user.trustLevel ?? 1) < minTrustLevel)
    throw new AppError(
      `مستوى الثقة غير كافٍ — يلزم Level ${minTrustLevel} على الأقل`,
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const now          = new Date();

  const activeCount = await donationRequestRepository.countActiveMonthlyRequests({
    userId,
    month: currentMonth,
    now,
  });

  if (activeCount >= settings.maxActiveRequestsPerMonth)
    throw new AppError(
      `لا يمكنك نشر أكثر من ${settings.maxActiveRequestsPerMonth} طلب نشط في الشهر`,
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
  const page     = Math.max(1, parseInt(query.page,  10) || 1);
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit    = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip     = (page - 1) * limit;

  const mine   = String(query.mine).toLowerCase() === 'true';
  const filter = {};

  if (query.category && query.category !== 'all') filter.category = query.category;
  if (query.location && query.location !== 'all') filter.location = query.location;
  if (query.urgency  && query.urgency  !== 'all') filter.urgency  = query.urgency;

  if (mine) {
    filter.requester = userId;             // طلباتي — كل الحالات
  } else {
    filter.status    = 'active';           // الكل — النشطة فقط
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
  const request = await donationRequestRepository.cancelOwnedActiveRequest({
    requestId,
    userId,
  });

  if (!request)
    throw new AppError(
      'الطلب غير موجود أو لا تملك صلاحية إلغائه',
      404,
      'REQUEST_NOT_FOUND_OR_FORBIDDEN'
    );

  return { msg: 'تم إلغاء الطلب ✅' };
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
// 5. الاستجابة لطلب تبرع
// ─────────────────────────────────────────────────────────────────────────────
exports.respondToRequestLogic = async (requestId, donorId, body, file) => {
  const mongoose = require('mongoose');

  const [request, donor, settings] = await Promise.all([
    donationRequestRepository.findActiveRequestById(requestId),
    User.findById(donorId).select('isVerified trustLevel name').lean(),
    SystemSettings.getCached(),
  ]);

  if (!request)
    throw new AppError('الطلب غير موجود أو غير نشط', 404, 'REQUEST_NOT_FOUND');

  if (request.requester._id.toString() === donorId)
    throw new AppError('لا يمكنك الاستجابة لطلبك الخاص 🚫', 400, 'CANNOT_RESPOND_OWN_REQUEST');

  if (!donor?.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  // ✅ trustLevel للتبرع (منفصل عن إنشاء الطلب)
  const minLevel = getMinTrustLevelForDonating(settings);
  if ((donor.trustLevel ?? 1) < minLevel)
    throw new AppError(
      `يلزم Level ${minLevel} على الأقل للتبرع`,
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );

  // ✅ 3 queries بالتوازي
  const [alreadyResponded, safeHub, activeCount] = await Promise.all([
    Item.exists({
      linkedRequestId: requestId,
      donor:           donorId,
      status:          { $in: ['متاح', 'محجوز'] },
    }),
    SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean(),
    Item.countDocuments({
      donor:  donorId,
      status: { $in: ['متاح', 'محجوز'] },
    }),
  ]);

  if (alreadyResponded)
    throw new AppError('لقد استجبت لهذا الطلب مسبقاً ⏳', 409, 'ALREADY_RESPONDED');

  if (!safeHub)
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');

  const maxItems =
    (donor.trustLevel ?? 1) >= 2
      ? (settings.level2Quota  ?? 4)
      : (settings.defaultQuota ?? 2);

  if (activeCount >= maxItems)
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`,
      429,
      'MAX_ACTIVE_ITEMS_REACHED'
    );

  // رفع الصورة إن وُجدت
  let imageUrl = null, cloudinaryId = null;
  if (file) {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(file.mimetype))
      throw new AppError('نوع الصورة غير مدعوم', 400, 'INVALID_IMAGE_TYPE');
    if (file.size > 5 * 1024 * 1024)
      throw new AppError('حجم الصورة يتجاوز 5MB', 400, 'IMAGE_TOO_LARGE');
    const uploaded = await uploadToCloudinary(file.buffer);
    imageUrl     = uploaded.secure_url;
    cloudinaryId = uploaded.public_id;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [item] = await Item.create(
      [{
        title:           request.title,
        description:     body.description?.trim() || request.description,
        category:        request.category,
        location:        request.location,           // ✅ دائماً من الطلب
        condition:       body.condition ?? 'جيد',    // ✅ default آمن
        safeHub:         body.safeHub,
        donor:           donorId,
        imageUrl,
        cloudinaryId,
        linkedRequestId: requestId,
        status:          'محجوز',
        bookedBy:        request.requester._id,
        bookedAt:        new Date(),
      }],
      { session }
    );

    await session.commitTransaction();
    try { session.endSession(); } catch (_) {}

    // إشعار صاحب الطلب خارج الـ Transaction
    setImmediate(async () => {
      try {
        const { getIO } = require('../socket');
        getIO().to(`user_${request.requester._id}`).emit('request:responded', {
          type:      'REQUEST_RESPONDED',
          requestId: request._id,
          itemId:    item._id,
          donorName: donor.name,
          title:     request.title,
          message:   `شخص لديه "${request.title}" ويريد التبرع به لك 🎁`,
          safeHub: {
            name:    safeHub.name,
            city:    safeHub.city,
            address: safeHub.address,
          },
        });

        await notifyUser(request.requester._id, {
          type:   'request_responded',
          title:  'شخص استجاب لطلبك! 🎁',
          body:   `"${request.title}" — توجّه لنقطة التسليم وأكّد الاستلام`,
          itemId: item._id,
        });
      } catch (err) {
        console.warn('[RespondToRequest] فشل الإشعار:', err.message);
      }
    });

    return {
      msg:  'شكراً! تم إنشاء الغرض وحجزه لصاحب الطلب تلقائياً 🎉',
      item: {
        _id:      item._id,
        title:    item.title,
        category: item.category,
        safeHub:  { name: safeHub.name, city: safeHub.city },
        status:   item.status,
      },
    };

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    try { session.endSession(); } catch (_) {}
    throw err;   // ✅ يرفع الخطأ لـ asyncHandler
  }
};