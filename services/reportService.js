const reportRepository = require('../repositories/reportRepository');
const notifyUser = require('../utils/notifyUser');
const AppError = require('../utils/AppError');
const { toReportResponse } = require('../dtos/reportDto');

const APPEAL_WINDOW_MS = 72 * 60 * 60 * 1000;

exports.createReport = async ({ reporterId, reportedUserId, itemId, reason, details }) => {
  if (reporterId.toString() === reportedUserId.toString()) {
    throw new AppError('لا يمكن الإبلاغ عن نفسك', 400, 'SELF_REPORT');
  }

  const report = await reportRepository.createReport({
    reporter: reporterId,
    reportedUser: reportedUserId,
    relatedItem: itemId,
    reason,
    details,
    status: 'pending',
  });

  await notifyUser(reportedUserId, {
    type: 'report_created',
    title: 'تم تقديم بلاغ بحقك',
    body: `سبب البلاغ: ${reason} — لديك 72 ساعة للطعن`,
    itemId: itemId ?? null,
  });

  return toReportResponse(report);
};

exports.submitAppeal = async ({ reportId, donorId, appealText }) => {
  const report = await reportRepository.findById(reportId);

  if (!report) {
    throw new AppError('البلاغ غير موجود', 404, 'REPORT_NOT_FOUND');
  }

  if (report.reportedUser.toString() !== donorId.toString()) {
    throw new AppError('غير مصرح', 403, 'FORBIDDEN');
  }

  const windowEnd = new Date(report.createdAt.getTime() + APPEAL_WINDOW_MS);
  if (new Date() > windowEnd) {
    throw new AppError('انتهت نافذة الطعن (72 ساعة)', 410, 'APPEAL_WINDOW_CLOSED');
  }

  if (report.appealText) {
    throw new AppError('تم تقديم الطعن مسبقاً', 409, 'ALREADY_APPEALED');
  }

  report.appealText = appealText;
  report.appealedAt = new Date();
  await reportRepository.save(report);

  return toReportResponse(report);
};