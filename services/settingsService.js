// services/settingsService.js
const SystemSettings = require('../models/SystemSettings');

const ALLOWED_FIELDS = [
  'defaultQuota', 'level2Quota', 'level3Quota', 'maxBookingsPerUser',
  'maxActiveRequestsPerMonth', 'requestExpiryDays',
  'categories', 'reportReasons', 'autoReportBanThreshold',
  'universityEmailDomains', 'requireHubForBooking',
  'maintenanceMode', 'platformName', 'contactEmail', 'quotaResetDayOfMonth',
];

exports.getSettings = () => SystemSettings.getCached();

exports.updateSettings = async (updates) => {
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) => ALLOWED_FIELDS.includes(k))
  );

  if (Object.keys(sanitized).length === 0)
    throw Object.assign(new Error('لا توجد حقول صالحة للتحديث'), { status: 400 });

  const updated = await SystemSettings.findByIdAndUpdate(
    'global',
    { $set: sanitized },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  // أبطل الـ cache بعد التعديل
  SystemSettings.invalidateCache();

  return updated;
};
