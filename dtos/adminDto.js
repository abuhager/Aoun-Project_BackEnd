// dtos/adminDto.js
const Joi = require('joi');

// ─── ترقية/خفض مستخدم ────────────────────────────────────────
// params.id يُتحقق منه بـ validateObjectId middleware في الـ route
// Body اختياري — لا يوجد body مطلوب في هذه العمليات
// لكن نُعرّف validatePromote لأي body مستقبلي (reason للـ AuditLog مثلاً)

exports.validatePromote = (body) => {
  const schema = Joi.object({
    reason: Joi.string().max(200).optional(), // ← للـ AuditLog في Phase 6
  });
  return schema.validate(body);
};