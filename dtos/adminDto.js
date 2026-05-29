const Joi = require('joi');

// ─── ترقية/خفض مستخدم ────────────────────────────────────────
// params.id يتحقق منه validateObjectId في الـ route

exports.validatePromote = (body) => {
  const schema = Joi.object({
    reason:    Joi.string().max(200).optional(),
    adminNote: Joi.string().max(500).optional(),
  }).unknown(false); // لا نسمح بحقول زيادة

  return schema.validate(body);
};