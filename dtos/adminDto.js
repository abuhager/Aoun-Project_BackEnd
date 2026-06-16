const Joi = require('joi');

// ─── ترقية/خفض مستخدم ────────────────────────────────────────
// params.id يتحقق منه validateObjectId في الـ route

exports.validatePromote = (body) => {
  const schema = Joi.object({
    reason:    Joi.string().max(200).allow('', null).optional(),
    adminNote: Joi.string().max(500).allow('', null).optional(),
  }).unknown(false); 

  return schema.validate(body);
};