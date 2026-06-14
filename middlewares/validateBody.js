// middlewares/validateBody.js
// ✅ FIX [HUB-01]: createHub — تغيير location إلى address ليطابق SafeHub Schema
// ✅ FIX [HUB-07]: updateSettings.defaultQuota.max رُفع من 10 إلى 20 ليطابق SystemSettings Schema
// بقية الـ schemas كما هي بدون تغيير

const Joi = require('joi');

const ARABIC_NAME = /^[\u0600-\u06FFa-zA-Z0-9\s.'-]{2,60}$/;
const PHONE_REGEX = /^\+?[0-9]{7,15}$/;
const OTP_REGEX   = /^\d{6}$/;
const OBJECT_ID   = Joi.string().hex().length(24);

const passwordRule = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .messages({
    'string.pattern.base': 'يجب أن تحتوي كلمة المرور على حرف كبير وصغير ورقم',
  });

const textField = (min, max) => Joi.string().min(min).max(max).trim();

const schemas = {
  // ──────────── auth ─────────────────────────────────────────
  register: Joi.object({
    name: Joi.string().pattern(ARABIC_NAME).min(2).max(60).required().trim(),
    email: Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: passwordRule.required(),
    phone: Joi.string().pattern(PHONE_REGEX).optional().trim()
      .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }).unknown(false),

  login: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: Joi.string().max(128).required(),
  }).unknown(false),

  verifyEmail: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
    otp:   Joi.string().length(6).pattern(OTP_REGEX).required(),
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

  // ──────────── admin ────────────────────────────────────────
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

  // ──────────── reports ──────────────────────────────────────
  createReport: Joi.object({
    reportedUser: OBJECT_ID.required(),
    relatedItem:  OBJECT_ID.optional(),
    reason:       Joi.string().min(3).max(300).required().trim(),
    details:      Joi.string().max(1000).optional().allow('').trim(),
  }).unknown(false),

  submitAppeal: Joi.object({
    appealText: Joi.string().min(10).max(1000).required().trim(),
  }).unknown(false),

  // ──────────── ratings ──────────────────────────────────────
  submitRating: Joi.object({
    itemId:  OBJECT_ID.required(),
    score:   Joi.number().integer().min(1).max(10).required(),
    comment: Joi.string().max(500).optional().allow('').trim(),
  }).unknown(false),

  // ──────────── items ────────────────────────────────────────
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

  // ──────────── donation requests ────────────────────────────
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

  // ──────────── hubs ─────────────────────────────────────────
  // ✅ FIX [HUB-01]: تغيير "location" إلى "address" — يطابق SafeHub Schema و hubDto
  createHub: Joi.object({
    name:    Joi.string().min(3).max(100).required().trim(),
    address: Joi.string().min(3).max(200).required().trim(), // ✅ كان: location
    city:    Joi.string().min(2).max(60).required().trim(),
    workingHours: Joi.string().max(100).optional().trim(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).unknown(false),

  // ✅ FIX [HUB-01]: تغيير "location" إلى "address" هنا أيضاً
  updateHub: Joi.object({
    name:         Joi.string().min(3).max(100).optional().trim(),
    address:      Joi.string().min(3).max(200).optional().trim(), // ✅ كان: location
    city:         Joi.string().min(2).max(60).optional().trim(),
    isActive:     Joi.boolean().optional(),
    workingHours: Joi.string().max(100).optional().trim(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).min(1).unknown(false),

  // ──────────── settings ─────────────────────────────────────
  // ✅ FIX [HUB-07]: defaultQuota.max رُفع من 10 → 20 (يطابق SystemSettings Schema)
  // ✅ FIX [HUB-07]: level2Quota.max رُفع من 15 → 20 (يطابق SystemSettings Schema)
  updateSettings: Joi.object({
    defaultQuota:               Joi.number().integer().min(1).max(20).optional(), // ✅ كان: max(10)
    level2Quota:                Joi.number().integer().min(1).max(20).optional(), // ✅ كان: max(15)
    maxBookingsPerUser:         Joi.number().integer().min(1).max(10).optional(),
    maxActiveRequestsPerMonth:  Joi.number().integer().min(1).max(5).optional(),
    requestExpiryDays:          Joi.number().integer().min(1).max(180).optional(),
    donorQuotaReward:           Joi.number().integer().min(0).max(5).optional(),
    trustScorePerDonation:      Joi.number().integer().min(0).max(20).optional(),
    trustScorePerRequest:       Joi.number().integer().min(0).max(10).optional(),
    bookingExpiryHours:         Joi.number().integer().min(1).max(336).optional(),
    categories: Joi.array()
      .items(Joi.string().min(2).max(50).trim())
      .min(1).max(30).optional(),
    reportReasons: Joi.array()
      .items(Joi.string().min(2).max(100).trim())
      .min(1).max(50).optional(),
    autoReportBanThreshold:   Joi.number().integer().min(1).max(20).optional(),
    quotaResetDayOfMonth:     Joi.number().integer().min(1).max(28).optional(),
    universityEmailDomains:   Joi.array()
      .items(Joi.string().min(2).max(100).trim()).optional(),
    requireHubForBooking:     Joi.boolean().optional(),
    maintenanceMode:          Joi.boolean().optional(),
    platformName:             Joi.string().min(2).max(100).trim().optional(),
    contactEmail:             Joi.string().email({ tlds: { allow: false } }).trim().optional(),
  }).min(1).unknown(false),

  // ──────────── phone ────────────────────────────────────────
  sendOtp: Joi.object({
    phone: Joi.string().pattern(PHONE_REGEX).required()
      .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }).unknown(false),

  verifyOtp: Joi.object({
    phone: Joi.string().pattern(PHONE_REGEX).required(),
    otp:   Joi.string().length(6).pattern(OTP_REGEX).required(),
  }).unknown(false),
};

const validateBody = (schemaName) => (req, res, next) => {
  const schema = schemas[schemaName];
  if (!schema) return next();

  const { error, value } = schema.validate(req.body, {
    abortEarly:    false,
    stripUnknown:  true,
    convert:       true,
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