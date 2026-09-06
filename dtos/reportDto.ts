import { toId, toPlainRecord } from './dtoTypes.js';

const DEFAULT_REPORT_REASONS = Object.freeze([
  'لم يُسلّم الغرض',
  'معلومات مضللة',
  'سلوك غير لائق',
  'غرض مختلف عن الوصف',
  'أخرى',
]);

export { DEFAULT_REPORT_REASONS };

export const toReportResponse = (rawReport: unknown) => {
  const report = toPlainRecord(rawReport);
  if (!report) return null;

  return ({
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
};

export default { DEFAULT_REPORT_REASONS, toReportResponse };
