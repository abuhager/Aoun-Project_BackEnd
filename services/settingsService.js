// services/settingsService.js
const SystemSettings = require('../models/SystemSettings');

// ─── إعدادات الـ In-Memory Cache ──────────────────────────────
let _settingsCache = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 1000; // صلاحية الكاش: دقيقة واحدة

const ALLOWED_FIELDS = [
  'defaultQuota', 'level2Quota', 'maxBookingsPerUser',
  'maxActiveRequestsPerMonth', 'requestExpiryDays',
  'categories', 'reportReasons', 'autoReportBanThreshold',
  'universityEmailDomains', 'requireHubForBooking',
  'maintenanceMode', 'platformName', 'contactEmail', 'quotaResetDayOfMonth',
];

// ─── جلب الإعدادات مع الفحص من الـ Cache ──────────────────────
exports.getSettings = async () => {
  const now = Date.now();

  // ✅ إذا كان الكاش متوفراً ولم تنتهِ صلاحيته، أعده فوراً بدون الاتصال بقاعدة البيانات
  if (_settingsCache && now < _cacheExpiresAt) {
    return _settingsCache;
  }

  // في حال عدم وجود كاش أو انتهاء صلاحيته، نقوم بجلب البيانات من DB
  const settings = await SystemSettings.findById('global').lean();

  // تحديث الكاش المحلي ووقت انتهاء الصلاحية
  _settingsCache = settings;
  _cacheExpiresAt = now + CACHE_TTL_MS;

  return settings;
};

// ─── تحديث الإعدادات وإبطال الكاش فوراً ────────────────────────
exports.updateSettings = async (updates) => {
  // تصفية الحقول لمنع حقن إعدادات غير مصرح بها
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) => ALLOWED_FIELDS.includes(k))
  );

  if (Object.keys(sanitized).length === 0) {
    throw Object.assign(new Error('لا توجد حقول صالحة للتحديث'), { status: 400 });
  }

  // تحديث المستند في قاعدة البيانات
  const updated = await SystemSettings.findByIdAndUpdate(
    'global',
    { $set: sanitized },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  // ✅ تحديث الكاش المحلي فوراً بالبيانات الجديدة وتمديد الـ TTL
  _settingsCache = updated;
  _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  return updated;
};