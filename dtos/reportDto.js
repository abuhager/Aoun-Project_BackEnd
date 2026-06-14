// dtos/reportDto.js — النسخة المُصلَحة الكاملة
const Joi = require('joi');

// ✅ REASONS مصدر الحقيقة الوحيد — يُستخدم في الـ validation والـ Schema
const REASONS = [
  'لم يُسلّم الغرض',
  'معلومات مضللة',
  'سلوك غير لائق',
  'غرض مختلف عن الوصف',
  'أخرى',
];

exports.REPORT_REASONS = REASONS;

// ✅ BUG-07: استخدام Joi.valid(...REASONS) ليطابق ما يُخزَّن في DB
exports.validateReport = (body) =>
  Joi.object({
    reportedUser: Joi.string().hex().length(24).required(),
    relatedItem:  Joi.string().hex().length(24).optional(),
    reason:       Joi.string().valid(...REASONS).required()
      .messages({ 'any.only': `السبب يجب أن يكون أحد: ${REASONS.join(', ')}` }),
    details:      Joi.string().max(1000).optional().allow('').trim(),
  }).validate(body, { abortEarly: false, stripUnknown: true });

exports.validateAppeal = (body) =>
  Joi.object({
    appealText: Joi.string().min(10).max(1000).required().trim(),
  }).validate(body, { abortEarly: false, stripUnknown: true });

// ✅ BUG-01: إضافة resolvedBy و appealDeadline لـ toReportResponse
exports.toReportResponse = (report) => ({
  _id:            report._id,
  reporter:       report.reporter,
  reportedUser:   report.reportedUser,
  relatedItem:    report.relatedItem,
  reason:         report.reason,
  details:        report.details,
  status:         report.status,
  adminNote:      report.adminNote     ?? null,
  appealText:     report.appealText    ?? null,
  appealedAt:     report.appealedAt    ?? null,
  appealDeadline: report.appealDeadline ?? null, // ✅ يُظهر للمستخدم متى تنتهي نافذة الطعن
  resolvedBy:     report.resolvedBy    ?? null,  // ✅ BUG-01
  resolvedAt:     report.resolvedAt    ?? null,
  createdAt:      report.createdAt,
  updatedAt:      report.updatedAt,
});