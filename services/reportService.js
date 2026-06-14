// services/reportService.js — النسخة المُصلَحة الكاملة
const reportRepository = require('../repositories/reportRepository');
const notifyUser       = require('../utils/notifyUser');
const AppError         = require('../utils/AppError');
const { toReportResponse } = require('../dtos/reportDto');

// ✅ مدة نافذة الطعن: 72 ساعة (ثابتة هنا — يمكن نقلها لـ SystemSettings في Flow 10)
const APPEAL_WINDOW_MS = 72 * 60 * 60 * 1000;

exports.createReport = async ({ reporterId, reportedUserId, itemId, reason, details }) => {
  // ✅ منع الإبلاغ عن النفس
  if (reporterId.toString() === reportedUserId.toString()) {
    throw new AppError('لا يمكن الإبلاغ عن نفسك', 400, 'SELF_REPORT');
  }

  // ✅ BUG-02: حفظ appealDeadline عند الإنشاء — adminRepository.buildPendingFilter يعتمد عليها
  const appealDeadline = new Date(Date.now() + APPEAL_WINDOW_MS);

  const report = await reportRepository.createReport({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId ?? null,
    reason,
    details,
    status:         'pending',
    appealDeadline,             // ✅ الإصلاح الجوهري
  });

  // إشعار المُبلَّغ عنه
  await notifyUser(reportedUserId, {
    type:   'report_created',
    title:  'تم تقديم بلاغ بحقك',
    body:   `سبب البلاغ: ${reason} — لديك 72 ساعة للطعن`,
    itemId: itemId ?? null,
  });

  return toReportResponse(report);
};

exports.submitAppeal = async ({ reportId, donorId, appealText }) => {
  const report = await reportRepository.findById(reportId);

  if (!report) {
    throw new AppError('البلاغ غير موجود', 404, 'REPORT_NOT_FOUND');
  }

  // ✅ يجب أن يكون المستخدم هو المُبلَّغ عنه
  if (report.reportedUser.toString() !== donorId.toString()) {
    throw new AppError('غير مصرح', 403, 'FORBIDDEN');
  }

  // ✅ التحقق من نافذة الطعن باستخدام appealDeadline المحفوظة (بدلاً من إعادة الحساب)
  if (!report.appealDeadline || new Date() > report.appealDeadline) {
    throw new AppError('انتهت نافذة الطعن (72 ساعة)', 410, 'APPEAL_WINDOW_CLOSED');
  }

  // ✅ منع تكرار الطعن
  if (report.appealText) {
    throw new AppError('تم تقديم الطعن مسبقاً', 409, 'ALREADY_APPEALED');
  }

  report.appealText = appealText;
  report.appealedAt = new Date();
  await reportRepository.save(report);

  return toReportResponse(report);
};