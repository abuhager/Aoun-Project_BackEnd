const DEFAULT_REPORT_REASONS = Object.freeze([
  'لم يُسلّم الغرض',
  'معلومات مضللة',
  'سلوك غير لائق',
  'غرض مختلف عن الوصف',
  'أخرى',
]);

const toId = (value) => {
  if (!value) return null;
  return String(value._id ?? value);
};

exports.DEFAULT_REPORT_REASONS = DEFAULT_REPORT_REASONS;

// ✅ BUG-01: إضافة resolvedBy و appealDeadline لـ toReportResponse
exports.toReportResponse = (report) => ({
  _id:            toId(report._id),
  reporter:       toId(report.reporter),
  reportedUser:   toId(report.reportedUser),
  relatedItem:    toId(report.relatedItem),
  reason:         report.reason,
  details:        report.details,
  status:         report.status,
  adminNote:      report.adminNote     ?? null,
  appealText:     report.appealText    ?? null,
  appealedAt:     report.appealedAt    ?? null,
  appealDeadline: report.appealDeadline ?? null, // ✅ يُظهر للمستخدم متى تنتهي نافذة الطعن
  resolvedBy:     toId(report.resolvedBy),
  resolvedAt:     report.resolvedAt    ?? null,
  createdAt:      report.createdAt,
  updatedAt:      report.updatedAt,
});
