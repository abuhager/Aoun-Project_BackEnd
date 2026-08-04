// services/reportService.js
const reportRepository = require('../repositories/reportRepository');
const AppError         = require('../utils/AppError');
const notifyUser       = require('../utils/notifyUser');
const SystemSettings   = require('../models/SystemSettings');

// ─── إنشاء بلاغ ───────────────────────────────────────────────
exports.createReport = async (reporterId, { reportedUserId, itemId, reason, details }) => {
  if (reporterId.toString() === reportedUserId.toString())
    throw new AppError('لا يمكنك الإبلاغ عن نفسك', 400, 'SELF_REPORT');

  // ✅ FIX [REPORT-01]: guard صريح بدل الاعتماد على unique index
  const dup = await reportRepository.findExistingPending(
    reporterId, reportedUserId, itemId ?? null
  );
  if (dup)
    throw new AppError(
      'لديك بلاغ مفتوح مسبقاً على هذا المستخدم',
      409,
      'DUPLICATE_REPORT'
    );

  const settings      = await SystemSettings.getCached();
  const appealWindow  = settings?.appealWindowHours ?? 72;
  const appealDeadline = new Date(Date.now() + appealWindow * 60 * 60 * 1000);

  const report = await reportRepository.createReport({
    reporter:       reporterId,
    reportedUser:   reportedUserId,
    relatedItem:    itemId ?? null,
    reason,
    details:        details ?? '',
    status:         'pending',
    appealDeadline,
  });

  return report;
};

// ─── استئناف / طعن ────────────────────────────────────────────
exports.submitAppeal = async (reportId, userId, { appealText }) => {
  const report = await reportRepository.findById(reportId);
  if (!report)
    throw new AppError('البلاغ غير موجود', 404, 'REPORT_NOT_FOUND');

  if (report.reportedUser.toString() !== userId.toString())
    throw new AppError('غير مصرح', 403, 'FORBIDDEN');

  if (report.appealText)
    throw new AppError('قدّمت اعتراضاً مسبقاً', 409, 'ALREADY_APPEALED');

  if (report.appealDeadline && new Date() > report.appealDeadline)
    throw new AppError('انتهت مهلة الاعتراض', 400, 'APPEAL_WINDOW_CLOSED');

  report.appealText = appealText.trim();
  report.appealedAt = new Date();
  await reportRepository.save(report);

  return report;
};