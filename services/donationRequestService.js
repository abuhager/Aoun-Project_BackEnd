// services/donationRequestService.js
const mongoose = require('mongoose');
const DonationRequest = require('../models/DonationRequest');
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');

// ── الحد الأدنى من الثقة لنشر طلب ─────────────────────────────
const MIN_TRUST_LEVEL = 2;

// ─── 1. نشر طلب جديد ─────────────────────────────────────────
exports.createRequestLogic = async (body, userId) => {
  const user = await User.findById(userId).select('trustLevel isVerified').lean();

  if (!user?.isVerified) {
    throw Object.assign(new Error('يجب تفعيل حسابك أولاً ✅'), { status: 403 });
  }

  if ((user.trustLevel ?? 1) < MIN_TRUST_LEVEL) {
    throw Object.assign(
      new Error('مستوى الثقة غير كافٍ — يلزم Level 2 على الأقل'),
      { status: 403 }
    );
  }

  const settings = await SystemSettings.getCached();
  const currentMonth = new Date().toISOString().slice(0, 7);

  const activeCount = await DonationRequest.countDocuments({
    requester: userId,
    month: currentMonth,
    status: 'active',
  });

  if (activeCount >= settings.maxActiveRequestsPerMonth) {
    throw Object.assign(
      new Error(`لا يمكنك نشر أكثر من ${settings.maxActiveRequestsPerMonth} طلب نشط في الشهر`),
      { status: 429, code: 'MONTHLY_LIMIT_EXCEEDED' }
    );
  }

  if (!settings.categories?.includes(body.category)) {
    throw Object.assign(
      new Error(`التصنيف "${body.category}" غير مدعوم`),
      { status: 400, code: 'INVALID_CATEGORY' }
    );
  }

  if (settings.locations?.length && !settings.locations.includes(body.location)) {
    throw Object.assign(
      new Error(`المنطقة "${body.location}" غير مدعومة`),
      { status: 400, code: 'INVALID_LOCATION' }
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (settings.requestExpiryDays ?? 30));

  const request = await DonationRequest.create({
    title: body.title?.trim(),
    description: body.description?.trim(),
    category: body.category,
    location: body.location?.trim(),
    urgency: body.urgency ?? 'medium',
    requester: userId,
    month: currentMonth,
    expiresAt,
    status: 'active',
  });

  return { msg: 'تم نشر طلبك بنجاح 🎉', request };
};

// ─── 2. جلب الطلبات (العامة أو "طلباتي") ─────────────────────
exports.getDonationRequestsLogic = async (query, userId) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(20, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const mine = String(query.mine).toLowerCase() === 'true';
  const filter = {};

  if (query.category && query.category !== 'all') {
    filter.category = query.category;
  }

  if (query.location && query.location !== 'all') {
    filter.location = query.location;
  }

  if (query.urgency && query.urgency !== 'all') {
    filter.urgency = query.urgency;
  }

  if (mine) {
    // ✅ "طلباتي" = فقط الطلبات الخاصة بالمستخدم الحالي
    filter.requester = userId;
  } else {
    // ✅ القائمة العامة = فقط الطلبات النشطة غير المنتهية
    filter.status = 'active';
    filter.expiresAt = { $gt: new Date() };
  }

  const [requests, total] = await Promise.all([
    DonationRequest.find(filter)
      .populate('requester', 'name avatar trustLevel trustScore')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    DonationRequest.countDocuments(filter),
  ]);

  return {
    requests,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

// ─── 3. إلغاء طلب (صاحبه فقط) ────────────────────────────────
exports.cancelRequestLogic = async (requestId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(requestId)) {
    throw Object.assign(new Error('معرّف غير صحيح'), { status: 400 });
  }

  const request = await DonationRequest.findOneAndUpdate(
    { _id: requestId, requester: userId, status: 'active' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );

  if (!request) {
    throw Object.assign(
      new Error('الطلب غير موجود أو لا تملك صلاحية إلغائه'),
      { status: 404 }
    );
  }

  return { msg: 'تم إلغاء الطلب ✅' };
};

// ─── 4. جلب طلبات المستخدم الخاصة + quota ───────────────────
exports.getMyRequestsLogic = async (userId) => {
  const requests = await DonationRequest.find({ requester: userId })
    .sort({ createdAt: -1 })
    .lean();

  const settings = await SystemSettings.getCached();
  const currentMonth = new Date().toISOString().slice(0, 7);

  const usedThisMonth = requests.filter(
    (r) => r.month === currentMonth && r.status === 'active'
  ).length;

  return {
    requests,
    quota: {
      used: usedThisMonth,
      max: settings.maxActiveRequestsPerMonth,
      remaining: Math.max(0, settings.maxActiveRequestsPerMonth - usedThisMonth),
    },
  };
};