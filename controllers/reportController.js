const reportService = require('../services/reportService');
const asyncHandler = require('../utils/asyncHandler');

exports.createReport = asyncHandler(async (req, res) => {
  const report = await reportService.createReport({
    reporterId: req.user.id,
    reportedUserId: req.body.reportedUser,
    itemId: req.body.relatedItem,
    reason: req.body.reason,
    details: req.body.details,
  });

  return res.status(201).json({
    msg: 'تم إرسال البلاغ ✅',
    report,
  });
});

exports.submitAppeal = asyncHandler(async (req, res) => {
  const report = await reportService.submitAppeal({
    reportId: req.params.id,
    donorId: req.user.id,
    appealText: req.body.appealText,
  });

  return res.status(200).json({
    msg: 'تم تقديم الطعن ✅',
    report,
  });
});