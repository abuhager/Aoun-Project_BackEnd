// controllers/adminController.js
const adminService = require('../services/adminService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { validatePromote } = require('../dtos/adminDto');

// ─── Users ────────────────────────────────────────────────────
exports.promoteUser = asyncHandler(async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR');
  }

  const user = await adminService.promoteToLevel2(
    req.params.id,
    req.user.id,
    req.body.reason,
    req.body.adminNote
  );

  return res.status(200).json({
    msg: `تمت ترقية ${user.name} ✅`,
    user,
  });
});

exports.demoteUser = asyncHandler(async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR');
  }

  const user = await adminService.demoteToLevel1(
    req.params.id,
    req.user.id,
    req.body.reason,
    req.body.adminNote
  );

  return res.status(200).json({
    msg: `تم خفض ${user.name}`,
    user,
  });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  res.json(result);
});

exports.banUser = asyncHandler(async (req, res) => {
  const user = await adminService.banUser(
    req.params.id,
    req.user.id,
    req.body.reason,
    req.body.adminNote
  );

  res.json({
    msg: `تم حظر ${user.name}`,
    user,
  });
});

exports.unbanUser = asyncHandler(async (req, res) => {
  const user = await adminService.unbanUser(
    req.params.id,
    req.user.id,
    req.body.adminNote
  );

  res.json({
    msg: `تم رفع الحظر عن ${user.name}`,
    user,
  });
});

// ─── Items ────────────────────────────────────────────────────
exports.listItems = asyncHandler(async (req, res) => {
  const result = await adminService.listItems(req.query);
  res.json(result);
});

exports.deleteItem = asyncHandler(async (req, res) => {
  if (!req.body.adminNote || !req.body.adminNote.trim()) {
    throw new AppError('تعليق الحذف مطلوب', 400, 'ADMIN_NOTE_REQUIRED');
  }

  await adminService.deleteItem(
    req.params.id,
    req.user.id,
    req.body.adminNote.trim()
  );

  res.json({ msg: 'تم حذف الغرض ✅' });
});

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = asyncHandler(async (req, res) => {
  const result = await adminService.listReports(req.query);
  res.json(result);
});

exports.resolveReport = asyncHandler(async (req, res) => {
  const report = await adminService.resolveReport(
    req.params.id,
    req.user.id,
    req.body.action,
    req.user.name,
    req.body.adminNote
  );

  res.json({
    msg: 'تم معالجة البلاغ ✅',
    report,
  });
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