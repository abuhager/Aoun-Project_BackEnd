// controllers/adminController.js
const adminService = require('../services/adminService');
import asyncHandler = require('../utils/asyncHandler');
const AppError     = require('../utils/AppError');
const adminDto     = require('../dtos/adminDto');

// ─── مساعد: تنظيف النصوص ──────────────────────────────────────
const cleanString = (str) => (typeof str === 'string' ? str.trim() : '');

// ─── Users ────────────────────────────────────────────────────
exports.promoteUser = asyncHandler(async (req, res) => {
  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.promoteToLevel2(
    req.params.id,
    req.user.id,
    req.user.role,
    reason,
    adminNote
  );
  return res.status(200).json({
    msg: `تمت ترقية ${user.name} ✅`,
    user: adminDto.toAdminUser(user),
  });
});

exports.demoteUser = asyncHandler(async (req, res) => {
  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.demoteToLevel1(
    req.params.id,
    req.user.id,
    req.user.role,
    reason,
    adminNote
  );
  return res.status(200).json({
    msg: `تم خفض ${user.name}`,
    user: adminDto.toAdminUser(user),
  });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  res.json(result);
});

exports.banUser = asyncHandler(async (req, res) => {
  const targetUserId = req.params.id;

  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.banUser(
    targetUserId,
    req.user.id,
    req.user.role,
    reason,
    adminNote
  );

  res.json({
    msg: `تم حظر ${user.name} وتطهير كافة حجوزاته وجلساته النشطة بنجاح 🚫`,
    user: adminDto.toAdminUser(user),
  });
});

exports.unbanUser = asyncHandler(async (req, res) => {
  const adminNote = cleanString(req.body?.adminNote);
  const user = await adminService.unbanUser(
    req.params.id,
    req.user.id,
    req.user.role,
    adminNote
  );
  res.json({
    msg: `تم رفع الحظر عن ${user.name}`,
    user: adminDto.toAdminUser(user),
  });
});

// ─── Items ────────────────────────────────────────────────────
exports.listItems = asyncHandler(async (req, res) => {
  const result = await adminService.listItems(req.query);
  res.json(result);
});

exports.deleteItem = asyncHandler(async (req, res) => {
  const adminNote = cleanString(req.body.adminNote);
  await adminService.deleteItem(req.params.id, req.user.id, adminNote);
  res.json({ msg: 'تم حذف الغرض ✅' });
});

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = asyncHandler(async (req, res) => {
  const { page = 1 } = req.query;
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  const ALLOWED_STATUSES = ['pending', 'actioned', 'dismissed', 'reviewed'];
  if (status && !ALLOWED_STATUSES.includes(status)) {
    throw new AppError('فلتر حالة البلاغ غير صالح', 422, 'INVALID_REPORT_STATUS');
  }

  const result = await adminService.listReports({ page, status: status || null });
  res.json(result);
});

exports.resolveReport = asyncHandler(async (req, res) => {
  // ✅ FIX BUG-01: قراءة "status" بدلاً من "action" ليطابق Frontend payload
  const status    = cleanString(req.body.status);
  const adminNote = cleanString(req.body.adminNote);

  if (!adminNote) {
    throw new AppError('ملاحظة المشرف مطلوبة', 400, 'ADMIN_NOTE_REQUIRED');
  }

  const report = await adminService.resolveReport(
    req.params.id,
    req.user.id,
    req.user.role,
    status,
    adminNote
  );

  res.json({ msg: 'تم معالجة البلاغ ✅', report });
});

// ─── Audit Log ────────────────────────────────────────────────
exports.listAuditLogs = asyncHandler(async (req, res) => {
  const result = await adminService.listAuditLogs(req.query);
  res.json(result);
});

// ─── Stats ────────────────────────────────────────────────────
exports.getStats = asyncHandler(async (_req, res) => {
  const stats = await adminService.getStats();
  res.json(stats);
});
