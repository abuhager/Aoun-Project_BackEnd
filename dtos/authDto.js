// dtos/authDto.js
const Joi = require('joi');

exports.validateRegister = (body) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    phone: Joi.string().optional()
  });

  return schema.validate(body);
};

exports.validateVerifyEmail = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required()  // ✅ 6 أرقام
  });

  return schema.validate(body);
};

exports.validateLogin = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  });

  return schema.validate(body);
};

exports.validateForgotPassword = (body) => {
  const schema = Joi.object({
    email: Joi.string().email().required()
  });

  return schema.validate(body);
};

exports.validateResetPassword = (body) => {
  const schema = Joi.object({
    password: Joi.string().min(6).required()
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
    currentPassword: Joi.string().required().messages({ 'any.required': 'كلمة المرور الحالية مطلوبة' }),
    newPassword:     Joi.string().min(6).required().messages({
      'string.min':   'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل',
      'any.required': 'كلمة المرور الجديدة مطلوبة',
    }),
  }).validate(data);
