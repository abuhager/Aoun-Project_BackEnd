// services/reportService.js
// ✅ Phase 4: البلاغ + نافذة الطعن (72 ساعة) — بدون خصم تلقائي
const Report = require('../models/Report');
const Item   = require('../models/Item');

const APPEAL_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 ساعة

// ─── إنشاء بلاغ ──────────────────────────────────────────
exports.createReport = async ({ reporterId, reportedUserId, itemId, reason, details }) => {

  if (reporterId.toString() === reportedUserId.toString())
    throw Object.assign(
      new Error('لا يمكن الإبلاغ عن نفسك'),
      { status: 400, code: 'SELF_REPORT' }
    );

  // ✅ منع التكرار (unique index في الـ schema)
  const report = await Report.create({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId,
    reason,
    details,
    status: 'pending',  // ✅ لا إجراء تلقائي أبداً
  });

  return report;
};

// ─── تقديم طعن من المتبرع ────────────────────────────────
exports.submitAppeal = async ({ reportId, donorId, appealText }) => {

  const report = await Report.findById(reportId);

  if (!report)
    throw Object.assign(new Error('البلاغ غير موجود'), { status: 404, code: 'REPORT_NOT_FOUND' });

  // ✅ فقط المُبلَّغ عنه يقدر يطعن
  if (report.reportedUser.toString() !== donorId.toString())
    throw Object.assign(new Error('غير مصرح'), { status: 403, code: 'FORBIDDEN' });

  // ✅ نافذة الطعن 72 ساعة فقط
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