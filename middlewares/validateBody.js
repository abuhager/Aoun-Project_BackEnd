// middlewares/validateBody.js

const Joi = require('joi');

// ─── Regex Patterns ──────────────────────────────────────────────────────────
const ARABIC_NAME    = /^[\u0600-\u06FFa-zA-Z0-9\s.'-]{2,60}$/;
const PHONE_REGEX    = /^\+?[0-9]{7,15}$/;
const OTP_REGEX      = /^\d{6}$/;
// ✅ FIX-VB-01: OBJECT_ID كانت Joi.string مجردة غير مُغلقة — الآن تعريف صحيح كـ const
const OBJECT_ID      = Joi.string().hex().length(24);
// ✅ FIX-VB-02: EMAIL_DOMAIN regex مُحكمة — تمنع @@ أو domain بدون نقطة
const EMAIL_DOMAIN   = /^@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

// ─── Reusable Rules ───────────────────────────────────────────────────────────
const passwordRule = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .messages({
    'string.pattern.base': 'يجب أن تحتوي كلمة المرور على حرف كبير وصغير ورقم على الأقل',
  });

const textField = (min, max) => Joi.string().min(min).max(max).trim();

// ─── Schemas ──────────────────────────────────────────────────────────────────
const schemas = {

  // ──────────── auth ─────────────────────────────────────────────────────────
  register: Joi.object({
    name:     Joi.string().pattern(ARABIC_NAME).min(2).max(60).required().trim(),
    email:    Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: passwordRule.required(),
    phone:    Joi.string().pattern(PHONE_REGEX).optional().trim()
                .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }).unknown(false),

  login: Joi.object({
    email:    Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: Joi.string().max(128).required(),
  }).unknown(false),

  verifyEmail: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
    otp:   Joi.string().length(6).pattern(OTP_REGEX).required(),
  }).unknown(false),

  // ✅ FIX [SEC-AUTH-01]: schema مستقلة — لا تطلب otp إطلاقاً
  resendOtp: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
  }).unknown(false),

  forgotPassword: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
  }).unknown(false),

  resetPassword: Joi.object({
    token:    Joi.string().min(20).max(500).required().trim(),
    password: passwordRule.required(),
  }).unknown(false),

  updateMe: Joi.object({
    name:  Joi.string().pattern(ARABIC_NAME).min(2).max(60).optional().trim(),
    phone: Joi.string().pattern(PHONE_REGEX).optional().trim()
             .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }).min(1).unknown(false),

  updatePassword: Joi.object({
    currentPassword: Joi.string().min(8).max(128).required(),
    newPassword: passwordRule
      .invalid(Joi.ref('currentPassword'))
      .required()
      .messages({ 'any.invalid': 'يجب أن تكون كلمة المرور الجديدة مختلفة عن الحالية' }),
  }).unknown(false),

  // ──────────── admin ────────────────────────────────────────────────────────
  banUser: Joi.object({
    reason:    Joi.string().min(5).max(500).required().trim(),
    adminNote: Joi.string().max(1000).optional().allow('').trim(),
  }).unknown(false),

  resolveReport: Joi.object({
    action:    Joi.string().valid('warn', 'ban', 'dismiss').required(),
    adminNote: Joi.string().max(1000).optional().allow('').trim(),
  }).unknown(false),

  adjustTrust: Joi.object({
    delta: Joi.number().integer().min(-100).max(100).required(),
  }).unknown(false),

  promoteUser: Joi.object({
    reason:    Joi.string().max(200).optional().allow('').trim(),
    adminNote: Joi.string().max(500).optional().allow('').trim(),
  }).unknown(false),

  deleteItemAdmin: Joi.object({
    adminNote: Joi.string().min(3).max(1000).required().trim(),
  }).unknown(false),

  // ──────────── reports ──────────────────────────────────────────────────────
  createReport: Joi.object({
    reportedUser: OBJECT_ID.required(),
    relatedItem:  OBJECT_ID.optional(),
    reason:       Joi.string().min(3).max(300).required().trim(),
    details:      Joi.string().max(1000).optional().allow('').trim(),
  }).unknown(false),

  submitAppeal: Joi.object({
    appealText: Joi.string().min(10).max(1000).required().trim(),
  }).unknown(false),

  // ──────────── ratings ──────────────────────────────────────────────────────
  submitRating: Joi.object({
    itemId:  OBJECT_ID.required(),
    score:   Joi.number().integer().min(1).max(10).required(),
    comment: Joi.string().max(500).optional().allow('').trim(),
  }).unknown(false),

  // ──────────── items ────────────────────────────────────────────────────────
  createItem: Joi.object({
    title:       textField(3, 100).required(),
    description: Joi.string().max(1000).optional().allow('').trim(),
    category:    textField(1, 50).required(),
    location:    textField(2, 100).required(),
    condition:   textField(2, 50).required(),
    safeHub:     OBJECT_ID.required(),
  }).unknown(false),

  respondToRequest: Joi.object({
    condition:   textField(2, 50).required(),
    safeHub:     OBJECT_ID.required(),
    description: Joi.string().max(500).optional().allow('').trim(),
    location:    textField(2, 100).optional(),
  }).unknown(false),

  updateItem: Joi.object({
    title:       textField(3, 100).optional(),
    description: Joi.string().max(1000).optional().allow('').trim(),
    category:    textField(1, 50).optional(),
    location:    textField(2, 100).optional(),
    condition:   textField(2, 50).optional(),
    safeHub:     OBJECT_ID.optional(),
  }).min(1).unknown(false),

  completeDelivery: Joi.object({
    confirmationType: Joi.string()
      .valid('recipient_confirm', 'donor_confirm')
      .required(),
  }).unknown(false),

  // ──────────── donation requests ────────────────────────────────────────────
  createDonationRequest: Joi.object({
    title:       Joi.string().min(3).max(100).required().trim(),
    description: Joi.string().max(500).optional().allow('').trim(),
    category:    Joi.string().min(1).max(50).required().trim(),
    location:    Joi.string().min(2).max(100).required().trim(),
    urgency:     Joi.string().valid('low', 'medium', 'high').default('medium'),
  }).unknown(false),

  submitOffer: Joi.object({
    condition:   textField(2, 50).required(),
    safeHub:     OBJECT_ID.required(),
    description: Joi.string().max(500).optional().allow('').trim(),
  }).unknown(false),

  // ──────────── hubs ─────────────────────────────────────────────────────────
  // ✅ FIX [HUB-01]: address بدل location ليطابق SafeHub Schema
  createHub: Joi.object({
    name:         Joi.string().min(3).max(100).required().trim(),
    address:      Joi.string().min(3).max(200).required().trim(),
    city:         Joi.string().min(2).max(60).required().trim(),
    workingHours: Joi.string().max(100).optional().trim(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).unknown(false),

  updateHub: Joi.object({
    name:         Joi.string().min(3).max(100).optional().trim(),
    address:      Joi.string().min(3).max(200).optional().trim(),
    city:         Joi.string().min(2).max(60).optional().trim(),
    isActive:     Joi.boolean().optional(),
    workingHours: Joi.string().max(100).optional().trim(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).min(1).unknown(false),

  // ──────────── settings ─────────────────────────────────────────────────────
  // ✅ FIX [DC-01]: أضفنا maxActiveDonationsPerUser و maxActiveDonationsLevel2Plus
  // ✅ FIX [HUB-07]: defaultQuota.max رُفع إلى 20
  // ✅ FIX-VB-02: universityEmailDomains تستخدم EMAIL_DOMAIN regex مُحكمة
  updateSettings: Joi.object({
    defaultQuota:                  Joi.number().integer().min(1).max(20).optional(),
    level2Quota:                   Joi.number().integer().min(1).max(20).optional(),
    maxBookingsPerUser:             Joi.number().integer().min(1).max(10).optional(),
    maxActiveRequestsPerMonth:      Joi.number().integer().min(1).max(5).optional(),
    requestExpiryDays:              Joi.number().integer().min(1).max(180).optional(),
    donorQuotaReward:               Joi.number().integer().min(0).max(5).optional(),
    trustScorePerDonation:          Joi.number().integer().min(0).max(20).optional(),
    trustScorePerRequest:           Joi.number().integer().min(0).max(10).optional(),
    bookingExpiryHours:             Joi.number().integer().min(1).max(336).optional(),
    // ✅ DC-01 FIX: الحقلان المفقودان — إذا غابا من هنا يرفضهما Joi بـ 422
    maxActiveDonationsPerUser:      Joi.number().integer().min(1).max(20).optional(),
    maxActiveDonationsLevel2Plus:   Joi.number().integer().min(1).max(20).optional(),
    categories: Joi.array()
      .items(Joi.string().min(2).max(50).trim())
      .min(1).max(30).optional(),
    reportReasons: Joi.array()
      .items(Joi.string().min(2).max(100).trim())
      .min(1).max(50).optional(),
    autoReportBanThreshold: Joi.number().integer().min(1).max(20).optional(),
    quotaResetDayOfMonth:   Joi.number().integer().min(1).max(28).optional(),
    // ✅ FIX-VB-02: regex مُحكمة تمنع قيم مثل "@" أو "abc" بدون نقطة
    universityEmailDomains: Joi.array()
      .items(
        Joi.string().trim().pattern(EMAIL_DOMAIN)
          .message('كل نطاق يجب أن يبدأ بـ @ مثل: @ju.edu.jo')
      )
      .max(50).optional(),
    requireHubForBooking: Joi.boolean().optional(),
    maintenanceMode:      Joi.boolean().optional(),
    platformName:         Joi.string().min(2).max(100).trim().optional(),
    contactEmail:         Joi.string()
                            .email({ tlds: { allow: false } })
                            .trim().optional(),
  }).min(1).unknown(false),

  // ──────────── phone ────────────────────────────────────────────────────────
  sendOtp: Joi.object({
    phone: Joi.string().pattern(PHONE_REGEX).required()
             .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }).unknown(false),

  verifyOtp: Joi.object({
    phone: Joi.string().pattern(PHONE_REGEX).required(),
    otp:   Joi.string().length(6).pattern(OTP_REGEX).required(),
  }).unknown(false),
};

// ─── Middleware ───────────────────────────────────────────────────────────────
// ✅ FIX-VB-03: الكود الأصلي كان يستخدم `dtos[schemaName]` بدل `schemas[schemaName]`
//              مما يُسبب crash فورياً — الآن يستخدم `schemas` الصحيح
// ✅ FIX-VB-04: إذا لم يوجد الـ schema → next() صامت خطر!
//              الآن يُعيد 500 لأن schema مجهول يعني bug في الكود لا خطأ من المستخدم
const validateBody = (schemaName) => (req, res, next) => {
  const schema = schemas[schemaName];

  // FIX-VB-04: schema غير موجود = خطأ في الكود نفسه وليس في الطلب
  if (!schema) {
    const err = new Error(`[validateBody] schema غير معرّف: "${schemaName}"`);
    err.status = 500;
    return next(err);
  }

  const { error, value } = schema.validate(req.body, {
    abortEarly:   false,  // أظهر كل الأخطاء دفعة واحدة
    stripUnknown: true,   // احذف الحقول الزائدة تلقائياً
    convert:      true,   // حوّل "20" → 20 تلقائياً
  });

  if (error) {
    return res.status(422).json({
      msg:    'بيانات غير صالحة',
      code:   'VALIDATION_ERROR',
      errors: error.details.map((d) => d.message),
    });
  }

  req.body = value;
  next();
};

module.exports = validateBody;