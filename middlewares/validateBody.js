// middlewares/validateBody.js
const Joi = require('joi');

const ARABIC_NAME = /^[\u0600-\u06FFa-zA-Z0-9\s.'-]{2,60}$/;
const PHONE_REGEX = /^\+?[0-9]{7,15}$/;
const OTP_REGEX = /^\d{6}$/;
const OBJECT_ID = Joi.string().hex().length(24);

const passwordRule = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .messages({
    'string.pattern.base': 'يجب أن تحتوي كلمة المرور على حرف كبير وصغير ورقم',
  });

const schemas = {
  // ──────────── auth ────────────────────────────────────────────
  register: Joi.object({
    name: Joi.string()
      .pattern(ARABIC_NAME)
      .min(2)
      .max(60)
      .required()
      .trim(),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .max(100)
      .required()
      .lowercase()
      .trim(),
    password: passwordRule.required(),
    phone: Joi.string()
      .pattern(PHONE_REGEX)
      .optional()
      .trim()
      .messages({
        'string.pattern.base': 'رقم الهاتف غير صالح',
      }),
  }),

  login: Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .max(100)
      .required()
      .lowercase()
      .trim(),
    password: Joi.string().max(128).required(),
  }),

  verifyEmail: Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .lowercase()
      .trim(),
    otp: Joi.string().length(6).pattern(OTP_REGEX).required(),
  }),

  forgotPassword: Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .lowercase()
      .trim(),
  }),

  // ✅ متوافق مع authController الحالي
  resetPassword: Joi.object({
    token: Joi.string().min(20).max(500).required().trim(),
    password: passwordRule.required(),
  }),

  // ✅ لإزالة validation اليدوي من authController.updateMe
  updateMe: Joi.object({
    name: Joi.string()
      .pattern(ARABIC_NAME)
      .min(2)
      .max(60)
      .optional()
      .trim(),
    phone: Joi.string()
      .pattern(PHONE_REGEX)
      .optional()
      .trim()
      .messages({
        'string.pattern.base': 'رقم الهاتف غير صالح',
      }),
  }).min(1),

  // ✅ لإزالة validation اليدوي من authController.updatePassword
  updatePassword: Joi.object({
    currentPassword: Joi.string().min(8).max(128).required(),
    newPassword: passwordRule.invalid(Joi.ref('currentPassword')).required().messages({
      'any.invalid': 'يجب أن تكون كلمة المرور الجديدة مختلفة عن الحالية',
    }),
  }),

  // ──────────── admin ───────────────────────────────────────────
  banUser: Joi.object({
    reason: Joi.string().min(5).max(500).required().trim(),
    adminNote: Joi.string().max(1000).optional().allow('').trim(),
  }),

  // ✅ متوافق مع adminService.resolveReport
  resolveReport: Joi.object({
    action: Joi.string().valid('warn', 'ban', 'dismiss').required(),
    adminNote: Joi.string().max(1000).optional().allow('').trim(),
  }),

  adjustTrust: Joi.object({
    delta: Joi.number().integer().min(-100).max(100).required(),
  }),

  // ✅ متوافق مع adminDto الحالي ومنطق promote/demote
  promoteUser: Joi.object({
    reason: Joi.string().max(200).optional().allow('').trim(),
    adminNote: Joi.string().max(500).optional().allow('').trim(),
  }),

  deleteItemAdmin: Joi.object({
    adminNote: Joi.string().min(3).max(1000).required().trim(),
  }),

  // ──────────── reports ─────────────────────────────────────────
  createReport: Joi.object({
    reportedUser: OBJECT_ID.required(),
    relatedItem: OBJECT_ID.optional(),
    reason: Joi.string().min(3).max(300).required().trim(),
    details: Joi.string().max(1000).optional().allow('').trim(),
  }),

  submitAppeal: Joi.object({
    appealText: Joi.string().min(10).max(1000).required().trim(),
  }),

  // ──────────── ratings ─────────────────────────────────────────
  submitRating: Joi.object({
    itemId: OBJECT_ID.required(),
    score: Joi.number().integer().min(1).max(10).required(),
    comment: Joi.string().max(500).optional().allow('').trim(),
  }),

  // ──────────── donation requests ──────────────────────────────
  createDonationRequest: Joi.object({
    title: Joi.string().min(3).max(100).required().trim(),
    description: Joi.string().max(500).optional().allow('').trim(),
    category: Joi.string().min(1).max(50).required().trim(),
    location: Joi.string().min(2).max(100).required().trim(),
    urgency: Joi.string().valid('low', 'medium', 'high').default('medium'),
  }),

  // ──────────── hubs ────────────────────────────────────────────
  createHub: Joi.object({
    name: Joi.string().min(3).max(100).required().trim(),
    location: Joi.string().min(3).max(200).required().trim(),
    city: Joi.string().min(2).max(60).required().trim(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }),

  updateHub: Joi.object({
    name: Joi.string().min(3).max(100).optional().trim(),
    location: Joi.string().min(3).max(200).optional().trim(),
    city: Joi.string().min(2).max(60).optional().trim(),
    isActive: Joi.boolean().optional(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).min(1),

  // ──────────── settings ────────────────────────────────────────
  updateSettings: Joi.object({
    maxActiveItems: Joi.number().integer().min(1).max(20).optional(),
    maxActiveRequests: Joi.number().integer().min(1).max(10).optional(),
    categories: Joi.array()
      .items(Joi.string().min(2).max(50).trim())
      .min(1)
      .max(30)
      .optional(),
  }).min(1),

  // ──────────── phone ───────────────────────────────────────────
  sendOtp: Joi.object({
    phone: Joi.string()
      .pattern(PHONE_REGEX)
      .required()
      .messages({
        'string.pattern.base': 'رقم الهاتف غير صالح',
      }),
  }),

  verifyOtp: Joi.object({
    phone: Joi.string().pattern(PHONE_REGEX).required(),
    otp: Joi.string().length(6).pattern(OTP_REGEX).required(),
  }),
};

const validateBody = (schemaName) => (req, res, next) => {
  const schema = schemas[schemaName];

  if (!schema) {
    return next();
  }

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(422).json({
      msg: 'بيانات غير صالحة',
      code: 'VALIDATION_ERROR',
      errors: error.details.map((d) => d.message),
    });
  }

  req.body = value;
  next();
};

module.exports = validateBody;