// middlewares/validateBody.js

const Joi = require('joi');

// ─── Regex Patterns ────────────────────────────────────────────────
const ARABIC_NAME    = /^[\u0600-\u06FFa-zA-Z0-9\s.'-]{2,60}$/;
const {
  JORDAN_PHONE_REGEX: PHONE_REGEX,
  normalizeJordanPhone,
} = require('../utils/phoneUtils');
const OTP_REGEX      = /^\d{6}$/;
const EMAIL_DOMAIN   = /^@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

// ─── Factory Functions & Reusable Rules ─────────────────────────────
const objectId = () => Joi.string()
  .hex()
  .length(24)
  .messages({ 'string.length': 'معرّف غير صالح (ObjectId يجب أن يكون 24 حرف)' });

const passwordRule = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .messages({
    'string.pattern.base': 'يجب أن تحتوي كلمة المرور على حرف كبير وصغير ورقم على الأقل',
  });

const jordanPhoneRule = Joi.string()
  .max(32)
  .custom((value, helpers) => {
    const normalized = normalizeJordanPhone(value);
    return PHONE_REGEX.test(normalized)
      ? normalized
      : helpers.error('string.pattern.base');
  })
  .messages({
    'string.pattern.base': 'رقم الهاتف غير صالح — استخدم رقماً أردنياً يبدأ بـ 77 أو 78 أو 79',
  });

const textField = (min, max) => Joi.string().min(min).max(max).trim();

// ─── Schemas ─────────────────────────────────────────────────────
const schemas = {

  // ──────────── auth ──────────────────────────────────────────────────
  register: Joi.object({
    name:     Joi.string().pattern(ARABIC_NAME).min(2).max(60).required().trim(),
    email:    Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: passwordRule.required(),
    phone:    jordanPhoneRule.required(),
  }).unknown(false),

  login: Joi.object({
    email:    Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: Joi.string().max(128).required(),
  }).unknown(false),

  verifyEmail: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
    otp:   Joi.string().length(6).pattern(OTP_REGEX).required(),
  }).unknown(false),

  resendOtp: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
  }).unknown(false),

  forgotPassword: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
  }).unknown(false),

  resetPassword: Joi.object({
    password: passwordRule.required(),
  }).unknown(false),

  updateMe: Joi.object({
    name:  Joi.string().pattern(ARABIC_NAME).min(2).max(60).optional().trim(),
    phone: jordanPhoneRule.optional(),
  }).min(1).unknown(false),

  updatePassword: Joi.object({
    currentPassword: Joi.string().min(8).max(128).required(),
    newPassword: passwordRule
      .invalid(Joi.ref('currentPassword'))
      .required()
      .messages({ 'any.invalid': 'يجب أن تكون كلمة المرور الجديدة مختلفة عن الحالية' }),
  }).unknown(false),

  // ──────────── admin ──────────────────────────────────────────────────
  banUser: Joi.object({
    reason:    Joi.string().min(5).max(500).required().trim(),
    adminNote: Joi.string().max(1000).optional().allow('').trim(),
  }).unknown(false),

  resolveReport: Joi.object({
    status: Joi.string()
      .valid('reviewed', 'dismissed', 'actioned')
      .required()
      .messages({ 'any.only': 'الحالة يجب أن تكون: reviewed أو dismissed أو actioned' }),
    adminNote: Joi.string().min(3).max(1000).required().trim()
      .messages({
        'string.empty': 'ملاحظة المشرف مطلوبة',
        'string.min': 'ملاحظة المشرف يجب أن تكون 3 أحرف على الأقل',
      }),
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

  // ──────────── reports ──────────────────────────────────────────────
  createReport: Joi.object({
    reportedUser: objectId().required(),
    relatedItem:  objectId().optional(),
    reason:       Joi.string().min(3).max(300).required().trim(),
    details:      Joi.string().max(1000).optional().allow('').trim(),
  }).unknown(false),

  submitAppeal: Joi.object({
    appealText: Joi.string().min(10).max(1000).required().trim(),
  }).unknown(false),

  // ──────────── ratings ──────────────────────────────────────────────
  submitRating: Joi.object({
    itemId:  objectId().required(),
    score:   Joi.number().integer().min(1).max(10).required(),
    comment: Joi.string().max(500).optional().allow('').trim(),
  }).unknown(false),

  // ──────────── items ────────────────────────────────────────────────
  createItem: Joi.object({
    title:       textField(3, 100).required(),
    description: Joi.string().max(1000).optional().allow('').trim(),
    category:    textField(1, 50).required(),
    location:    textField(2, 100).required(),
    condition:   textField(2, 50).required(),
    safeHub:     objectId().required(),
  }).unknown(false),

  respondToRequest: Joi.object({
    condition:   textField(2, 50).required(),
    safeHub:     objectId().required(),
    description: Joi.string().max(500).optional().allow('').trim(),
    location:    textField(2, 100).optional(),
  }).unknown(false),

  updateItem: Joi.object({
    title:       textField(3, 100).optional(),
    description: Joi.string().max(1000).optional().allow('').trim(),
    category:    textField(1, 50).optional(),
    location:    textField(2, 100).optional(),
    condition:   textField(2, 50).optional(),
    safeHub:     objectId().optional(),
  }).min(1).unknown(false),

  completeDelivery: Joi.object({
    confirmationType: Joi.string()
      .valid('recipient_confirm', 'donor_confirm')
      .required(),
  }).unknown(false),

  // ──────────── donation requests ──────────────────────────────────
  createDonationRequest: Joi.object({
    title:       Joi.string().min(3).max(100).required().trim(),
    description: Joi.string().max(500).optional().allow('').trim(),
    category:    Joi.string().min(1).max(50).required().trim(),
    location:    Joi.string().min(2).max(100).required().trim(),
    urgency:     Joi.string().valid('low', 'medium', 'high').default('medium'),
  }).unknown(false),

  submitOffer: Joi.object({
    condition:   textField(2, 50).required(),
    safeHub:     objectId().required(),
    description: Joi.string().max(500).optional().allow('').trim(),
  }).unknown(false),

  // ──────────── hubs ────────────────────────────────────────────────
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

  // ──────────── settings ─────────────────────────────────────────
  updateSettings: Joi.object({
    defaultQuota:                   Joi.number().integer().min(1).max(20).optional(),
    defaultUserQuota:               Joi.number().integer().min(1).max(20).optional(),
    studentQuota:                   Joi.number().integer().min(1).max(20).optional(),
    level2Quota:                    Joi.number().integer().min(1).max(20).optional(),
    maxBookingsPerUser:             Joi.number().integer().min(1).max(10).optional(),
    maxActiveRequestsPerMonth:      Joi.number().integer().min(1).max(5).optional(),
    maxActiveDonationsPerUser:      Joi.number().integer().min(1).max(20).optional(),
    maxActiveDonationsLevel2Plus:   Joi.number().integer().min(1).max(20).optional(),
    maxPendingOffersPerDonor:       Joi.number().integer().min(1).max(20).optional(),
    donorQuotaReward:               Joi.number().integer().min(0).max(5).optional(),
    quotaResetDayOfMonth:           Joi.number().integer().min(1).max(28).optional(),
    studentDefaultTrustLevel:       Joi.number().integer().min(1).max(2).optional(),
    minTrustLevelForRequests:       Joi.number().integer().min(1).max(2).optional(),
    minTrustLevelForDonating:       Joi.number().integer().min(1).max(2).optional(),
    trustScorePerDonation:          Joi.number().integer().min(0).max(20).optional(),
    trustScorePerRequest:           Joi.number().integer().min(0).max(10).optional(),
    ratingThresholdExcellent:       Joi.number().integer().min(1).max(10).optional(),
    ratingThresholdGood:            Joi.number().integer().min(1).max(10).optional(),
    ratingThresholdNeutral:         Joi.number().integer().min(1).max(10).optional(),
    ratingThresholdBad:             Joi.number().integer().min(1).max(10).optional(),
    bookingExpiryHours:             Joi.number().integer().min(1).max(336).optional(),
    requestExpiryDays:              Joi.number().integer().min(1).max(180).optional(),
    otpExpiryMinutes:               Joi.number().integer().min(1).max(60).optional(),
    maxOtpAttempts:                 Joi.number().integer().min(1).max(10).optional(),
    resetPasswordExpiryMinutes:     Joi.number().integer().min(5).max(60).optional(),
    maxAvatarSizeMb:                Joi.number().integer().min(1).max(20).optional(),
    avatarWidth:                    Joi.number().integer().min(100).max(1000).optional(),
    avatarHeight:                   Joi.number().integer().min(100).max(1000).optional(),
    maxPageSize:                    Joi.number().integer().min(5).max(100).optional(),
    profilePageSize:                Joi.number().integer().min(5).max(50).optional(),
    adminPageSize:                  Joi.number().integer().min(5).max(100).optional(),
    adminReportsPageSize:           Joi.number().integer().min(5).max(100).optional(),
    categories: Joi.array()
      .items(Joi.string().min(2).max(50).trim())
      .min(1).max(30).optional(),
    reportReasons: Joi.array()
      .items(Joi.string().min(2).max(100).trim())
      .min(1).max(50).optional(),
    universityEmailDomains: Joi.array()
      .items(
        Joi.string().trim().pattern(EMAIL_DOMAIN)
          .message('كل نطاق يجب أن يبدأ بـ @ مثل: @ju.edu.jo')
      )
      .max(50).optional(),
    autoReportBanThreshold:         Joi.number().integer().min(1).max(20).optional(),
    requireHubForBooking:           Joi.boolean().optional(),
    maintenanceMode:                Joi.boolean().optional(),
    platformName:                   Joi.string().min(2).max(100).trim().optional(),
    contactEmail:                   Joi.string()
                                      .email({ tlds: { allow: false } })
                                      .trim().optional(),
  }).min(1).unknown(false),

  // ──────────── phone ────────────────────────────────────────────────
  sendOtp: Joi.object({
    phone: Joi.string().pattern(PHONE_REGEX).required()
             .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }).unknown(false),

  // ✅ إصلاح: حذف phone — السيرفر يجيبه من DB عبر req.user
  verifyOtp: Joi.object({
    otp: Joi.string().length(6).pattern(OTP_REGEX).required()
           .messages({ 'string.length': 'الرمز يجب أن يتكون من 6 أرقام' }),
  }).unknown(false),

  verifyPhoneToken: Joi.object({
    idToken: Joi.string().min(100).max(10_000).required(),
  }).unknown(false),
};

// ─── Middleware ─────────────────────────────────────────────────────
const validateBody = (schemaName) => (req, res, next) => {
  const schema = schemas[schemaName];

  if (!schema) {
    const err = new Error(`[validateBody] schema غير معرّف: "${schemaName}"`);
    err.status = 500;
    return next(err);
  }

  const { error, value } = schema.validate(req.body, {
    abortEarly:   false,
    stripUnknown: true,
    convert:      true,
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
