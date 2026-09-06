import adminService from '../services/adminService.js';
import type { AdminRole } from '../services/adminService.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import adminDto from '../dtos/adminDto.js';

// ─── مساعد: تنظيف النصوص ──────────────────────────────────────
const cleanString = (str: unknown) => (typeof str === 'string' ? str.trim() : '');
const currentAdminRole = (role: Express.AuthenticatedUser['role']): AdminRole => {
  if (role === 'admin' || role === 'super_admin') return role;
  throw new AppError('صلاحية الإدارة مطلوبة', 403, 'ADMIN_REQUIRED');
};

export const promoteUser = asyncHandler(async (req, res) => {
  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.promoteToLevel2(
    req.params.id,
    req.user!.id,
    currentAdminRole(req.user!.role),
    reason,
    adminNote
  );
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  return res.status(200).json({
    msg: `تمت ترقية ${user.name} ✅`,
    user: adminDto.toAdminUser(user),
  });
});

export const demoteUser = asyncHandler(async (req, res) => {
  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.demoteToLevel1(
    req.params.id,
    req.user!.id,
    currentAdminRole(req.user!.role),
    reason,
    adminNote
  );
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  return res.status(200).json({
    msg: `تم خفض ${user.name}`,
    user: adminDto.toAdminUser(user),
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  res.json(result);
});

export const banUser = asyncHandler(async (req, res) => {
  const targetUserId = req.params.id;

  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.banUser(
    targetUserId,
    req.user!.id,
    currentAdminRole(req.user!.role),
    reason,
    adminNote
  );

  res.json({
    msg: `تم حظر ${user.name} وتطهير كافة حجوزاته وجلساته النشطة بنجاح 🚫`,
    user: adminDto.toAdminUser(user),
  });
});

export const unbanUser = asyncHandler(async (req, res) => {
  const adminNote = cleanString(req.body?.adminNote);
  const user = await adminService.unbanUser(
    req.params.id,
    req.user!.id,
    currentAdminRole(req.user!.role),
    adminNote
  );
  res.json({
    msg: `تم رفع الحظر عن ${user.name}`,
    user: adminDto.toAdminUser(user),
  });
});

export const listItems = asyncHandler(async (req, res) => {
  const result = await adminService.listItems(req.query);
  res.json(result);
});

export const deleteItem = asyncHandler(async (req, res) => {
  const adminNote = cleanString(req.body.adminNote);
  await adminService.deleteItem(req.params.id, req.user!.id, adminNote);
  res.json({ msg: 'تم حذف الغرض ✅' });
});

export const listReports = asyncHandler(async (req, res) => {
  const { page = 1 } = req.query;
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  const ALLOWED_STATUSES = ['pending', 'actioned', 'dismissed', 'reviewed'];
  if (status && !ALLOWED_STATUSES.includes(status)) {
    throw new AppError('فلتر حالة البلاغ غير صالح', 422, 'INVALID_REPORT_STATUS');
  }

  const result = await adminService.listReports({
    page: Number(page) || 1,
    status: status || null,
  });
  res.json(result);
});

export const resolveReport = asyncHandler(async (req, res) => {
  // ✅ FIX BUG-01: قراءة "status" بدلاً من "action" ليطابق Frontend payload
  const status    = cleanString(req.body.status);
  const adminNote = cleanString(req.body.adminNote);

  if (!adminNote) {
    throw new AppError('ملاحظة المشرف مطلوبة', 400, 'ADMIN_NOTE_REQUIRED');
  }

  const report = await adminService.resolveReport(
    req.params.id,
    req.user!.id,
    currentAdminRole(req.user!.role),
    status,
    adminNote
  );

  res.json({ msg: 'تم معالجة البلاغ ✅', report });
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await adminService.listAuditLogs(req.query);
  res.json(result);
});

export const getStats = asyncHandler(async (_req, res) => {
  const stats = await adminService.getStats();
  res.json(stats);
});

export default { promoteUser, demoteUser, listUsers, banUser, unbanUser, listItems, deleteItem, listReports, resolveReport, listAuditLogs, getStats };
