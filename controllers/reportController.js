// controllers/reportController.js — النسخة المُصلَحة الكاملة
const reportService  = require('../services/reportService');
const asyncHandler   = require('../utils/asyncHandler');
const AppError       = require('../utils/AppError');
const { validateReport, validateAppeal } = require('../dtos/reportDto');

// ✅ BUG-04: أضيفت validation يدوية داخل الـ controller
// (أو يمكن نقلها إلى route باستخدام validateBody('createReport') و validateBody('submitAppeal'))

exports.createReport = asyncHandler(async (req, res) => {
  // ✅ Validation الصريح قبل أي منطق
  const { error, value } = validateReport(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 422, 'VALIDATION_ERROR');
  }

  const report = await reportService.createReport({
    reporterId:     req.user.id,
    reportedUserId: value.reportedUser,
    itemId:         value.relatedItem ?? null,
    reason:         value.reason,
    details:        value.details ?? null,
  });

  return res.status(201).json({
    msg: 'تم إرسال البلاغ ✅',
    report,
  });
});

exports.submitAppeal = asyncHandler(async (req, res) => {
  // ✅ Validation الصريح
  const { error, value } = validateAppeal(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 422, 'VALIDATION_ERROR');
  }

  const report = await reportService.submitAppeal({
    reportId:   req.params.id,
    donorId:    req.user.id,
    appealText: value.appealText,
  });

  return res.status(200).json({
    msg: 'تم تقديم الطعن ✅',
    report,
  });
});