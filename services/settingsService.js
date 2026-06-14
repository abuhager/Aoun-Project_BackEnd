// services/settingsService.js
// ✅ FIX [HUB-06]: حذف الـ cache المكرر من هنا — SystemSettings.js يملك getCached()
// ✅ FIX [HUB-05]: في بيئة PM2 cluster — cache واحد في مستوى الـ Model أفضل من اثنين
//    settingsService الآن delegate نظيف بدون cache مكرر

const SystemSettings = require('../models/SystemSettings');

const ALLOWED_FIELDS = [
  'defaultQuota', 'level2Quota', 'maxBookingsPerUser',
  'maxActiveRequestsPerMonth', 'requestExpiryDays',
  'donorQuotaReward', 'trustScorePerDonation', 'trustScorePerRequest',
  'bookingExpiryHours', 'categories', 'reportReasons',
  'autoReportBanThreshold', 'universityEmailDomains',
  'requireHubForBooking', 'maintenanceMode',
  'platformName', 'contactEmail', 'quotaResetDayOfMonth',
];

// ── جلب الإعدادات — يعتمد على getCached() الموجود في Model ──
// ✅ FIX [HUB-06]: لا cache هنا — SystemSettings.getCached() يكفي
exports.getSettings = async () => {
  return SystemSettings.getCached();
};

// ── تحديث الإعدادات وإبطال الكاش فوراً ────────────────────
exports.updateSettings = async (updates) => {
  // تصفية الحقول لمنع حقن إعدادات غير مصرح بها
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) => ALLOWED_FIELDS.includes(k))
  );

  if (Object.keys(sanitized).length === 0) {
    throw Object.assign(new Error('لا توجد حقول صالحة للتحديث'), { status: 400 });
  }

  const updated = await SystemSettings.findByIdAndUpdate(
    'global',
    { $set: sanitized },
    { returnDocument: 'after', upsert: true, runValidators: true }
  ).lean();

  // ✅ إبطال الكاش المركزي في SystemSettings بعد كل تحديث
  SystemSettings.invalidateCache();

  return updated;
};