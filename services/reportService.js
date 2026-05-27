// services/reportService.js
const Report         = require('../models/Report');
const Item           = require('../models/Item');
const { notifyUser } = require('../utils/notifyUser');

const APPEAL_WINDOW_MS = 72 * 60 * 60 * 1000;

exports.createReport = async ({ reporterId, reportedUserId, itemId, reason, details }) => {

  if (reporterId.toString() === reportedUserId.toString())
    throw Object.assign(
      new Error('لا يمكن الإبلاغ عن نفسك'),
      { status: 400, code: 'SELF_REPORT' }
    );

  const report = await Report.create({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId,
    reason,
    details,
    status: 'pending',
  });

  // ✅ أبلغ المُبلَّغ عنه فوراً
  await notifyUser(reportedUserId, {
    type:   'report_resolved',
    title:  'تم تقديم بلاغ بحقك',
    body:   `سبب البلاغ: ${reason} — لديك 72 ساعة للطعن`,
    itemId: itemId ?? null,
  });

  return report;
};

exports.submitAppeal = async ({ reportId, donorId, appealText }) => {

  const report = await Report.findById(reportId);

  if (!report)
    throw Object.assign(new Error('البلاغ غير موجود'), { status: 404, code: 'REPORT_NOT_FOUND' });

  if (report.reportedUser.toString() !== donorId.toString())
    throw Object.assign(new Error('غير مصرح'), { status: 403, code: 'FORBIDDEN' });

  const windowEnd = new Date(report.createdAt.getTime() + APPEAL_WINDOW_MS);
  if (new Date() > windowEnd)
    throw Object.assign(
      new Error('انتهت نافذة الطعن (72 ساعة)'),
      { status: 410, code: 'APPEAL_WINDOW_CLOSED' }
    );

  if (report.appealText)
    throw Object.assign(
      new Error('تم تقديم الطعن مسبقاً'),
      { status: 409, code: 'ALREADY_APPEALED' }
    );

  report.appealText = appealText;
  report.appealedAt = new Date();
  await report.save();

  return report;
};