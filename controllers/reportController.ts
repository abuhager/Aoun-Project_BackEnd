const reportService  = require('../services/reportService');
const asyncHandler   = require('../utils/asyncHandler');
const { toReportResponse } = require('../dtos/reportDto');

exports.createReport = asyncHandler(async (req, res) => {
  const report = await reportService.createReport(req.user.id, req.body);

  return res.status(201).json({
    msg: 'تم إرسال البلاغ ✅',
    report: toReportResponse(report),
  });
});

exports.submitAppeal = asyncHandler(async (req, res) => {
  const report = await reportService.submitAppeal(
    req.params.id,
    req.user.id,
    req.body
  );

  return res.status(200).json({
    msg: 'تم تقديم الطعن ✅',
    report: toReportResponse(report),
  });
});
