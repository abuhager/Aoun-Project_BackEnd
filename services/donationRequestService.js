// services/donationRequestService.js
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');
const donationRequestRepository = require('../repositories/donationRequestRepository');
const AppError = require('../utils/AppError');
const Item    = require('../models/Item');
const SafeHub = require('../models/SafeHub');
const { uploadToCloudinary } = require('../utils/uploadToCloudinary');
const notifyUser = require('../utils/notifyUser');
// ✅ [FIX-6] MIN_TRUST_LEVEL مسحوب من SystemSettings — لا hardcoded
// ملاحظة: إن لم تكن موجودة في Settings، نستخدم 2 كـ fallback آمن
const getMinTrustLevel = (settings) => settings.minTrustLevelForRequests ?? 2;

// ─────────────────────────────────────────────────────────────────────────────────
// 1. إنشاء طلب تبرع جديد
// ─────────────────────────────────────────────────────────────────────────────────
exports.createRequestLogic = async (body, userId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel isVerified').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user?.isVerified) {
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');
  }

  // ✅ [FIX-6] minTrustLevel من settings بدلاً من hardcoded MIN_TRUST_LEVEL = 2
  const minTrustLevel = getMinTrustLevel(settings);
  if ((user.trustLevel ?? 1) < minTrustLevel) {
    throw new AppError(
      `مستوى الثقة غير كافٍ — يلزم Level ${minTrustLevel} على الأقل`,
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const now = new Date();

  const activeCount = await donationRequestRepository.countActiveMonthlyRequests({
    userId,
    month: currentMonth,
    now,
  });

  if (activeCount >= settings.maxActiveRequestsPerMonth) {
    throw new AppError(
      `لا يمكنك نشر أكثر من ${settings.maxActiveRequestsPerMonth} طلب نشط في الشهر`,
      429,
      'MONTHLY_LIMIT_EXCEEDED'
    );
  }

  if (!settings.categories?.includes(body.category)) {
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');
  }

  if (settings.locations?.length && !settings.locations.includes(body.location)) {
    throw new AppError(`المنطقة "${body.location}" غير مدعومة`, 400, 'INVALID_LOCATION');
  }

  // ✅ [FIX-6] requestExpiryDays من settings ✅ (كان موجوداً — نبقيه)
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
    status: 'active',
  });

  return { msg: 'تم نشر طلبك بنجاح 🎉', request };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 2. جلب قائمة طلبات التبرع
// ─────────────────────────────────────────────────────────────────────────────────
exports.getDonationRequestsLogic = async (query, userId) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);

  // ✅ [FIX-6] استخدام maxPageSize من الإعدادات
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const mine = String(query.mine).toLowerCase() === 'true';
  const includeHistory = String(query.includeHistory).toLowerCase() === 'true'; // خيار إضافي للتحكم
  const filter = {};

  if (query.category && query.category !== 'all') filter.category = query.category;
  if (query.location && query.location !== 'all') filter.location  = query.location;
  if (query.urgency  && query.urgency  !== 'all') filter.urgency   = query.urgency;

  if (mine) {
    filter.requester = userId;
    
    // ⚠️ [FIX LOGIC-2] إذا لم يطلب المستخدم رؤية التاريخ، نعرض النشط فقط أو نطبق قواعد منطقية
    if (!includeHistory) {
        filter.status = 'active';
        filter.expiresAt = { $gt: new Date() };
    }
  } else {
    filter.status    = 'active';
    filter.expiresAt = { $gt: new Date() };
  }

  const [requests, total] = await Promise.all([
    donationRequestRepository.findRequests({ filter, skip, limit }),
    donationRequestRepository.countRequests(filter),
  ]);

  return {
    requests,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 3. إلغاء طلب تبرع
// ─────────────────────────────────────────────────────────────────────────────────
exports.cancelRequestLogic = async (requestId, userId) => {
  const request = await donationRequestRepository.cancelOwnedActiveRequest({
    requestId,
    userId,
  });

  if (!request) {
    throw new AppError(
      'الطلب غير موجود أو لا تملك صلاحية إلغائه',
      404,
      'REQUEST_NOT_FOUND_OR_FORBIDDEN'
    );
  }

  return { msg: 'تم إلغاء الطلب ✅' };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 4. جلب طلباتي مع الـ Quota المتبقية
// ─────────────────────────────────────────────────────────────────────────────────
exports.getMyRequestsLogic = async (userId) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const now = new Date();

  const [requests, settings, usedThisMonth] = await Promise.all([
    donationRequestRepository.findUserRequests(userId),
    SystemSettings.getCached(),
    // ✅ عدّ في DB مباشرة — لا فلترة في الذاكرة
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
// ─────────────────────────────────────────────────────────────────────────────────
// 5. الاستجابة لطلب تبرع — "أنا عندي هذا"
//    المتبرع ينشئ Item مربوطاً بالطلب → يُحجز تلقائياً لصاحب الطلب
// ─────────────────────────────────────────────────────────────────────────────────
exports.respondToRequestLogic = async (requestId, donorId, body, file) => {
  const mongoose = require('mongoose');

  // 1. جلب الطلب + المتبرع + الإعدادات بالتوازي
  const [request, donor, settings] = await Promise.all([
    donationRequestRepository.findActiveRequestById(requestId),
    User.findById(donorId).select('isVerified trustLevel quota').lean(),
    SystemSettings.getCached(),
  ]);

  // ── Validations ─────────────────────────────────────────────────────────────
  if (!request)
    throw new AppError('الطلب غير موجود أو غير نشط', 404, 'REQUEST_NOT_FOUND');

  if (request.requester._id.toString() === donorId)
    throw new AppError('لا يمكنك الاستجابة لطلبك الخاص 🚫', 400, 'CANNOT_RESPOND_OWN_REQUEST');

  if (!donor?.isVerified)
    throw new AppError('يجب تفعيل حسابك أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  // تحقق من وجود Item مربوط بهذا الطلب من نفس المتبرع مسبقاً (لمنع التكرار)
  const alreadyResponded = await Item.exists({
    linkedRequestId: requestId,
    donor:           donorId,
    status:          { $in: ['متاح', 'محجوز'] },
  });
  if (alreadyResponded)
    throw new AppError('لقد استجبت لهذا الطلب مسبقاً ⏳', 409, 'ALREADY_RESPONDED');

  // تحقق من الـ SafeHub
  const safeHub = await SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean();
  if (!safeHub)
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');

  // تحقق من حصة المتبرع في الأغراض النشطة
  const activeCount = await Item.countDocuments({
    donor: donorId,
    status: { $in: ['متاح', 'محجوز'] },
  });
  const maxItems =
    (donor.trustLevel ?? 1) >= 2
      ? (settings.level2Quota ?? 4)
      : (settings.defaultQuota ?? 2);
  if (activeCount >= maxItems)
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`,
      429,
      'MAX_ACTIVE_ITEMS_REACHED'
    );

  // ── رفع الصورة إن وُجدت (اختيارية هنا لأن المتبرع قد لا يملك صورة) ─────
  let imageUrl = null, cloudinaryId = null;
  if (file) {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(file.mimetype))
      throw new AppError('نوع الصورة غير مدعوم', 400, 'INVALID_IMAGE_TYPE');
    if (file.size > 5 * 1024 * 1024)
      throw new AppError('حجم الصورة يتجاوز 5MB', 400, 'IMAGE_TOO_LARGE');
    const uploaded = await uploadToCloudinary(file.buffer);
    imageUrl      = uploaded.secure_url;
    cloudinaryId  = uploaded.public_id;
  }

  // ── إنشاء الـ Item مربوطاً بالطلب + حجزه لصاحب الطلب داخل transaction ──
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // إنشاء الـ Item محجوزاً مباشرةً لصاحب الطلب
    const [item] = await Item.create(
      [{
        title:           request.title,           // نفس عنوان الطلب
        description:     body.description?.trim() || request.description,
        category:        request.category,        // نفس تصنيف الطلب
        location:        body.location?.trim()    || request.location,
        condition:       body.condition,
        safeHub:         body.safeHub,
        donor:           donorId,
        imageUrl,
        cloudinaryId,
        linkedRequestId: requestId,               // ✅ الرابط المحوري
        // ── حجز فوري لصاحب الطلب ──
        status:    'محجوز',
        bookedBy:  request.requester._id,
        bookedAt:  new Date(),
      }],
      { session }
    );

    // حسم quota من صاحب الطلب (هو سيستلم)
    const updatedRequester = await User.findOneAndUpdate(
      { _id: request.requester._id, quota: { $gt: 0 } },
      { $inc: { quota: -1 } },
      { session, new: true }
    );

    if (!updatedRequester) {
      await session.abortTransaction();
      try { session.endSession(); } catch (_) {}
      throw new AppError(
        'صاحب الطلب لا يملك حصة كافية لاستلام الغرض حالياً',
        403,
        'REQUESTER_NO_QUOTA'
      );
    }

    await session.commitTransaction();
    try { session.endSession(); } catch (_) {}

    // ── إشعارات بعد نجاح الـ Transaction ───────────────────────────────────
    setImmediate(async () => {
      try {
        const { getIO } = require('../socket');
        const io = getIO();

        // إشعار فوري لصاحب الطلب عبر Socket
        io.to(`user_${request.requester._id}`).emit('request:responded', {
          type:      'REQUEST_RESPONDED',
          requestId: request._id,
          itemId:    item._id,
          donorName: donor.name,
          title:     request.title,
          message:   `شخص ما لديه "${request.title}" ويريد التبرع به لك 🎁`,
          safeHub: {
            name:    safeHub.name,
            city:    safeHub.city,
            address: safeHub.address,
          },
        });

        // إشعار DB لصاحب الطلب
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
      msg: 'شكراً! تم إنشاء الغرض وحجزه لصاحب الطلب تلقائياً 🎉',
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
    throw err;
  }
};
