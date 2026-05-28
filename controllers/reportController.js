// controllers/reportController.js
const reportService          = require('../services/reportService');
const { validateReport,
        validateAppeal }     = require('../dtos/reportDto');

exports.createReport = async (req, res) => {
  const { error } = validateReport(req.body);
  if (error)
    return res.status(400).json({ msg: error.details[0].message, code: 'VALIDATION_ERROR' });

  try {
    const report = await reportService.createReport({
      reporterId:     req.user.id,
      reportedUserId: req.body.reportedUserId,
      itemId:         req.body.itemId,
      reason:         req.body.reason,
      details:        req.body.details,
      appealDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    return res.status(201).json({ msg: 'تم إرسال البلاغ ✅', report });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message, code: err.code ?? 'SERVER_ERROR' });
  }
};

exports.submitAppeal = async (req, res) => {
  const { error } = validateAppeal(req.body);
  if (error)
    return res.status(400).json({ msg: error.details[0].message, code: 'VALIDATION_ERROR' });

  try {
    const report = await reportService.submitAppeal({
      reportId:   req.params.id,
      donorId:    req.user.id,
      appealText: req.body.appealText,
    });
    return res.status(200).json({ msg: 'تم تقديم الطعن ✅', report });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message, code: err.code ?? 'SERVER_ERROR' });
  }
};

