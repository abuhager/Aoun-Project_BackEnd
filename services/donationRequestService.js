// services/donationRequestService.js
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');
const donationRequestRepository = require('../repositories/donationRequestRepository');
const AppError = require('../utils/AppError');

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

  // ✅ [FIX-6] maxPageSize من settings بدلاً من hardcoded 20
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const mine = String(query.mine).toLowerCase() === 'true';
  const filter = {};

  if (query.category && query.category !== 'all') filter.category = query.category;
  if (query.location && query.location !== 'all') filter.location  = query.location;
  if (query.urgency  && query.urgency  !== 'all') filter.urgency   = query.urgency;

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
  const [requests, settings] = await Promise.all([
    donationRequestRepository.findUserRequests(userId),
    SystemSettings.getCached(),
  ]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const now = new Date();

  const usedThisMonth = requests.filter(
    (request) =>
      request.month === currentMonth &&
      request.status === 'active' &&
      (!request.expiresAt || new Date(request.expiresAt) > now)
  ).length;

  return {
    requests,
    quota: {
      used:      usedThisMonth,
      max:       settings.maxActiveRequestsPerMonth,
      remaining: Math.max(0, settings.maxActiveRequestsPerMonth - usedThisMonth),
    },
  };
};