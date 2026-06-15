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

// ─── validateRegister ──────────────────────────────────────────
exports.validateRegister = (body) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    password: strongPassword, // ✅ تطبيق كلمة المرور القوية
    phone: Joi.string()       // ✅ تطبيق التحقق من رقم الهاتف
      .pattern(/^[0-9]{9,15}$/)
      .optional()
      .messages({ 
        'string.pattern.base': 'رقم الهاتف يجب أن يحتوي على أرقام فقط (9-15 رقم)' 
      })
  });

  return schema.validate(body);
};

// ─── validateVerifyEmail ───────────────────────────────────────
exports.validateVerifyEmail = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required()  // ✅ 6 أرقام
  });

  return schema.validate(body);
};

// ─── validateLogin ─────────────────────────────────────────────
exports.validateLogin = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    // في تسجيل الدخول، نكتفي بالتحقق من وجود النص دون القيود الصارمة 
    // للسماح للمستخدمين القدامى (إن وُجدوا بكلمات ضعيفة) بتسجيل الدخول وتحديثها
    password: Joi.string().required()
  });

  return schema.validate(body);
};

// ─── validateForgotPassword ────────────────────────────────────
exports.validateForgotPassword = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required()
  });

  return schema.validate(body);
};

// ─── validateResetPassword ─────────────────────────────────────
exports.validateResetPassword = (body) => {
  const schema = Joi.object({
    password: strongPassword // ✅ تطبيق كلمة المرور القوية
  });

  return schema.validate(body);
};

// ─── validateUpdateMe ──────────────────────────────────────────
exports.validateUpdateMe = (data) =>
  Joi.object({
    name:  Joi.string().min(2).max(60).optional(),
    phone: Joi.string().pattern(/^[0-9]{9,15}$/).optional().allow(''),
  }).validate(data);

// ─── validateUpdatePassword ────────────────────────────────────
exports.validateUpdatePassword = (data) =>
  Joi.object({
    currentPassword: Joi.string().required().messages({ 
      'any.required': 'كلمة المرور الحالية مطلوبة' 
    }),
    newPassword: strongPassword // ✅ تطبيق كلمة المرور القوية
  }).validate(data);

  exports.validateResendOtp = (data) =>
  Joi.object({
    email: Joi.string().email().required().messages({
      'string.email':   'يرجى إدخال بريد إلكتروني صالح',
      'any.required':   'البريد الإلكتروني مطلوب',
    }),
  }).validate(data);