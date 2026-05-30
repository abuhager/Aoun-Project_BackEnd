// middlewares/validateBody.js
const Joi = require('joi');

const ARABIC_NAME = /^[\u0600-\u06FF\s\w.'-]{2,60}$/;

const schemas = {

  // ──────────── auth ────────────────────────────────────────────
  register: Joi.object({
    name:     Joi.string().pattern(ARABIC_NAME).min(2).max(60).required().trim(),
    email:    Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: Joi.string().min(8).max(128).required()
                .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
                  'يجب أن تحتوي على حرف كبير وصغير ورقم'),
  }),

  login: Joi.object({
    email:    Joi.string().email({ tlds: { allow: false } }).max(100).required().lowercase().trim(),
    password: Joi.string().max(128).required(),
  }),

  verifyEmail: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
    otp:   Joi.string().length(6).pattern(/^\d{6}$/).required(),
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
  }),

  resetPassword: Joi.object({
    email:       Joi.string().email({ tlds: { allow: false } }).required().lowercase().trim(),
    otp:         Joi.string().length(6).pattern(/^\d{6}$/).required(),
    newPassword: Joi.string().min(8).max(128).required()
                   .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
                     'يجب أن تحتوي على حرف كبير وصغير ورقم'),
  }),

  // ──────────── admin ───────────────────────────────────────────
  banUser: Joi.object({
    reason: Joi.string().min(5).max(500).required().trim(),
  }),

  resolveReport: Joi.object({
    status:    Joi.string().valid('resolved', 'dismissed').required(),
    adminNote: Joi.string().max(1000).optional().allow('').trim(),
  }),

  adjustTrust: Joi.object({
    delta: Joi.number().integer().min(-100).max(100).required(),
  }),

  promoteUser: Joi.object({
    role: Joi.string().valid('admin', 'user').required(),
  }),

  // ──────────── reports ─────────────────────────────────────────
  createReport: Joi.object({
    reportedUser: Joi.string().hex().length(24).required(),
    reason:       Joi.string().min(3).max(300).required().trim(),
    details:      Joi.string().max(1000).optional().allow('').trim(),
    relatedItem:  Joi.string().hex().length(24).optional(),
  }),

  submitAppeal: Joi.object({
    appealText: Joi.string().min(10).max(1000).required().trim(),
  }),

  // ──────────── ratings ─────────────────────────────────────────
  submitRating: Joi.object({
    itemId:  Joi.string().hex().length(24).required(),
    score: Joi.number().integer().min(1).max(10).required(),
    comment: Joi.string().max(500).optional().allow('').trim(),
  }),

  // ──────────── hubs ────────────────────────────────────────────
  createHub: Joi.object({
    name:        Joi.string().min(3).max(100).required().trim(),
    location:    Joi.string().min(3).max(200).required().trim(),
    city:        Joi.string().min(2).max(60).required().trim(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }),

  updateHub: Joi.object({
    name:        Joi.string().min(3).max(100).optional().trim(),
    location:    Joi.string().min(3).max(200).optional().trim(),
    city:        Joi.string().min(2).max(60).optional().trim(),
    isActive:    Joi.boolean().optional(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).min(1), // على الأقل حقل واحد

  // ──────────── settings ────────────────────────────────────────
  updateSettings: Joi.object({
    maxActiveItems:     Joi.number().integer().min(1).max(20).optional(),
    maxActiveRequests:  Joi.number().integer().min(1).max(5).optional(),
    categories:         Joi.array().items(
                          Joi.string().min(2).max(50).trim()
                        ).min(1).max(30).optional(),
  }).min(1),

  // ──────────── phone ───────────────────────────────────────────
  sendOtp: Joi.object({
    phone: Joi.string()
              .pattern(/^\+?[0-9]{7,15}$/)
              .required()
              .messages({ 'string.pattern.base': 'رقم الهاتف غير صالح' }),
  }),

  verifyOtp: Joi.object({
    phone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).required(),
    otp:   Joi.string().length(6).pattern(/^\d{6}$/).required(),
  }),

};

const validateBody = (schemaName) => (req, res, next) => {
  const schema = schemas[schemaName];
  if (!schema) return next();

  const { error, value } = schema.validate(req.body, {
    abortEarly:   false,  // أظهر كل الأخطاء دفعة واحدة
    stripUnknown: true,   // احذف أي حقل غير موجود في الـ schema
    convert:      true,   // حوّل النوع تلقائياً (string → number مثلاً)
  });

  if (error) {
    return res.status(422).json({
      msg:    'بيانات غير صالحة',
      errors: error.details.map((d) => d.message),
    });
  }

  req.body = value; // ✅ body نظيف ومُعقَّم
  next();
};

module.exports = validateBody;