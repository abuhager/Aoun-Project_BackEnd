// dtos/authDto.js
const Joi = require('joi');

// ─── سياسة كلمة المرور الموحدة ─────────────────────────────────
const strongPassword = Joi.string()
  .min(8)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._\-#^])[A-Za-z\d@$!%*?&._\-#^]{8,}$/)
  .required()
  .messages({
    'string.pattern.base': 'كلمة المرور يجب أن تحتوي على حرف كبير وصغير ورقم ورمز خاص على الأقل',
    'string.min': 'كلمة المرور يجب أن تكون 8 أحرف على الأقل',
    'any.required': 'كلمة المرور مطلوبة',
  });

// ✅ FIX: Regex موحَّد مع الـ Frontend — يقبل 9 أرقام تبدأ بـ 77/78/79 فقط
const jordanPhone = Joi.string()
  .pattern(/^(77|78|79)\d{7}$/)
  .optional()
  .messages({
    'string.pattern.base':
      'رقم الهاتف يجب أن يكون 9 أرقام ويبدأ بـ 77 أو 78 أو 79 (مثال: 791234567)',
  });

// ─── validateRegister ──────────────────────────────────────────
exports.validateRegister = (body) => {
  const schema = Joi.object({
    name:     Joi.string().min(3).max(50).required(),
    email:    Joi.string().email().required(),
    password: strongPassword,
    phone:    jordanPhone, // ✅ موحَّد الآن مع الـ Frontend
  });

  return schema.validate(body);
};

// ─── validateVerifyEmail ───────────────────────────────────────
exports.validateVerifyEmail = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    otp:   Joi.string().length(6).required(),
  });

  return schema.validate(body);
};

// ─── validateLogin ─────────────────────────────────────────────
exports.validateLogin = (body) => {
  const schema = Joi.object({
    email:    Joi.string().email().required(),
    password: Joi.string().required(),
  });

  return schema.validate(body);
};

// ─── validateForgotPassword ────────────────────────────────────
exports.validateForgotPassword = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
  });

  return schema.validate(body);
};

// ─── validateResetPassword ─────────────────────────────────────
exports.validateResetPassword = (body) => {
  const schema = Joi.object({
    password: strongPassword,
  });

  return schema.validate(body);
};

// ─── validateUpdateMe ──────────────────────────────────────────
exports.validateUpdateMe = (data) =>
  Joi.object({
    name:  Joi.string().min(2).max(60).optional(),
    phone: jordanPhone.allow(''), // ✅ نفس الـ Regex الموحَّد
  }).validate(data);

// ─── validateUpdatePassword ────────────────────────────────────
exports.validateUpdatePassword = (data) =>
  Joi.object({
    currentPassword: Joi.string().required().messages({
      'any.required': 'كلمة المرور الحالية مطلوبة',
    }),
    newPassword: strongPassword,
  }).validate(data);

// ─── validateResendOtp ─────────────────────────────────────────
exports.validateResendOtp = (data) =>
  Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'يرجى إدخال بريد إلكتروني صالح',
      'any.required': 'البريد الإلكتروني مطلوب',
    }),
  }).validate(data);