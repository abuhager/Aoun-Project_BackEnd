// dtos/settingsDto.js
// ⚠️ هذا الملف كان غائباً تماماً — validateBody('updateSettings') كانت تفشل صامتةً
// الآن: validation كاملة لكل حقل مطابقة للـ Schema

const Joi = require('joi');

const updateSettings = Joi.object({
  // ── حصص الحجز ──────────────────────────────────────────────
  defaultQuota:                 Joi.number().integer().min(1).max(20),
  level2Quota:                  Joi.number().integer().min(1).max(20),
  maxBookingsPerUser:           Joi.number().integer().min(1).max(10),

  // ── DC-01 FIX: الحقلان اللذان كانا غائبَين من ALLOWED_FIELDS ──
  maxActiveDonationsPerUser:    Joi.number().integer().min(1).max(20),
  maxActiveDonationsLevel2Plus: Joi.number().integer().min(1).max(20),

  // ── طلبات التبرع ────────────────────────────────────────────
  maxActiveRequestsPerMonth:    Joi.number().integer().min(1).max(5),
  requestExpiryDays:            Joi.number().integer().min(1).max(180),
  bookingExpiryHours:           Joi.number().integer().min(1).max(336),

  // ── نقاط الثقة ──────────────────────────────────────────────
  donorQuotaReward:             Joi.number().integer().min(0).max(5),
  trustScorePerDonation:        Joi.number().integer().min(0).max(20),
  trustScorePerRequest:         Joi.number().integer().min(0).max(10),

  // ── البلاغات ────────────────────────────────────────────────
  autoReportBanThreshold:       Joi.number().integer().min(1).max(20),
  reportReasons: Joi.array()
    .items(Joi.string().trim().min(3).max(100))
    .min(1).max(20),

  // ── التصنيفات ───────────────────────────────────────────────
  categories: Joi.array()
    .items(Joi.string().trim().min(2).max(50))
    .min(1).max(30),

  // ── الجدولة ─────────────────────────────────────────────────
  quotaResetDayOfMonth:         Joi.number().integer().min(1).max(28),

  // ── النطاقات الجامعية ────────────────────────────────────────
  universityEmailDomains: Joi.array()
    .items(
      Joi.string()
        .trim()
        .pattern(/^@[\w.-]+\.\w{2,}$/, { name: 'email-domain' })
        .message('كل نطاق يجب أن يبدأ بـ @ مثل @ju.edu.jo')
    )
    .max(50),

  // ── إعدادات عامة ────────────────────────────────────────────
  requireHubForBooking:         Joi.boolean(),
  maintenanceMode:              Joi.boolean(),
  platformName:                 Joi.string().trim().min(2).max(50),
  contactEmail:                 Joi.string().trim().email({ tlds: { allow: false } }),
})
  .min(1) // منع إرسال body فارغ
  .options({ allowUnknown: false }); // رفض أي حقل غير معروف

module.exports = { updateSettings };