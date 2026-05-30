const Joi = require('joi');

const REASONS = ['لم يُسلّم الغرض', 'معلومات مضللة', 'سلوك غير لائق', 'غرض مختلف عن الوصف', 'أخرى'];

exports.REPORT_REASONS = REASONS;

exports.validateReport = (body) =>
  Joi.object({
    reportedUser: Joi.string().hex().length(24).required(),
    relatedItem: Joi.string().hex().length(24).optional(),
    reason: Joi.string().valid(...REASONS).required(),
    details: Joi.string().max(500).optional().allow('').trim(),
  }).validate(body, { abortEarly: false, stripUnknown: true });

exports.validateAppeal = (body) =>
  Joi.object({
    appealText: Joi.string().min(10).max(500).required().trim(),
  }).validate(body, { abortEarly: false, stripUnknown: true });

exports.toReportResponse = (report) => ({
  _id: report._id,
  reporter: report.reporter,
  reportedUser: report.reportedUser,
  relatedItem: report.relatedItem,
  reason: report.reason,
  details: report.details,
  status: report.status,
  appealText: report.appealText,
  appealedAt: report.appealedAt,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});