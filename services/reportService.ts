// services/reportService.js
const reportRepository = require('../repositories/reportRepository');
const userRepository   = require('../repositories/userRepository');
const AppError         = require('../utils/AppError');
const SystemSettings   = require('../models/SystemSettings');
const { DEFAULT_REPORT_REASONS } = require('../dtos/reportDto');

const sameId = (left, right) => String(left ?? '') === String(right ?? '');

const assertValidItemContext = async ({ itemId, reporterId, reportedUserId }) => {
  if (!itemId) return;

  const item = await reportRepository.findContextItem(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  if (item.status !== 'تم التسليم') {
    throw new AppError(
      'يمكن إرسال البلاغ المرتبط بالغرض بعد اكتمال التسليم فقط',
      409,
      'REPORT_ITEM_NOT_DELIVERED'
    );
  }

  const partiesMatch = (
    sameId(item.donor, reporterId)
    && sameId(item.bookedBy, reportedUserId)
  ) || (
    sameId(item.donor, reportedUserId)
    && sameId(item.bookedBy, reporterId)
  );

  if (!partiesMatch) {
    throw new AppError(
      'لا يمكنك ربط البلاغ بمعاملة لا تخص الطرفين',
      403,
      'INVALID_REPORT_CONTEXT'
    );
  }
};

// ─── إنشاء بلاغ ───────────────────────────────────────────────
exports.createReport = async (reporterId, { reportedUserId, itemId, reason, details }) => {
  if (sameId(reporterId, reportedUserId))
    throw new AppError('لا يمكنك الإبلاغ عن نفسك', 400, 'SELF_REPORT');

  const [reportedUser, settings] = await Promise.all([
    userRepository.findById(reportedUserId),
    SystemSettings.getCached(),
  ]);
  if (!reportedUser) {
    throw new AppError('المستخدم المُبلّغ عنه غير موجود', 404, 'USER_NOT_FOUND');
  }
  if (reportedUser.role !== 'user') {
    throw new AppError(
      'لا يمكن استخدام مسار بلاغات المستخدمين ضد حساب إداري',
      403,
      'REPORT_TARGET_NOT_ALLOWED'
    );
  }

  const normalizedReason = String(reason ?? '').trim();
  const allowedReasons = settings?.reportReasons?.length
    ? settings.reportReasons
    : DEFAULT_REPORT_REASONS;
  if (!allowedReasons.includes(normalizedReason)) {
    throw new AppError('سبب البلاغ غير معتمد حالياً', 422, 'INVALID_REPORT_REASON');
  }

  await assertValidItemContext({ itemId, reporterId, reportedUserId });

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

  const appealWindow  = settings?.appealWindowHours ?? 72;
  const appealDeadline = new Date(Date.now() + appealWindow * 60 * 60 * 1000);

  try {
    return await reportRepository.createReport({
      reporter:       reporterId,
      reportedUser:   reportedUserId,
      relatedItem:    itemId ?? null,
      reason:          normalizedReason,
      details:         String(details ?? '').trim(),
      status:          'pending',
      appealDeadline,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError(
        'لديك بلاغ مفتوح مسبقاً على هذا المستخدم',
        409,
        'DUPLICATE_REPORT'
      );
    }
    throw error;
  }
};

// ─── استئناف / طعن ────────────────────────────────────────────
exports.submitAppeal = async (reportId, userId, { appealText }) => {
  const report = await reportRepository.findById(reportId);
  if (!report)
    throw new AppError('البلاغ غير موجود', 404, 'REPORT_NOT_FOUND');

  if (report.reportedUser.toString() !== userId.toString())
    throw new AppError('غير مصرح', 403, 'FORBIDDEN');

  if (report.status !== 'pending')
    throw new AppError('تم البت في البلاغ ولا يمكن الاعتراض عليه', 409, 'REPORT_ALREADY_RESOLVED');

  if (report.appealText)
    throw new AppError('قدّمت اعتراضاً مسبقاً', 409, 'ALREADY_APPEALED');

  if (report.appealDeadline && new Date() > report.appealDeadline)
    throw new AppError('انتهت مهلة الاعتراض', 400, 'APPEAL_WINDOW_CLOSED');

  const appealedAt = new Date();
  const updated = await reportRepository.submitAppeal({
    reportId,
    userId,
    appealText: appealText.trim(),
    appealedAt,
  });

  if (!updated) {
    throw new AppError(
      'تعذر قبول الاعتراض؛ حدّث الصفحة وحاول مرة أخرى',
      409,
      'APPEAL_CONFLICT'
    );
  }

  return updated;
};
