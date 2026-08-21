// controllers/adminController.js
const mongoose     = require('mongoose');
const adminService = require('../services/adminService');
const asyncHandler = require('../utils/asyncHandler');
const AppError     = require('../utils/AppError');
const { validatePromote } = require('../dtos/adminDto');

const Item      = require('../models/Item');
const { getIO } = require('../socket');

// ─── مساعد: تنظيف النصوص ──────────────────────────────────────
const cleanString = (str) => (typeof str === 'string' ? str.trim() : '');

// ─── Users ────────────────────────────────────────────────────
exports.promoteUser = asyncHandler(async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR');

  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.promoteToLevel2(
    req.params.id,
    req.user.id,
    req.user.role,
    reason,
    adminNote
  );
  return res.status(200).json({ msg: `تمت ترقية ${user.name} ✅`, user });
});

exports.demoteUser = asyncHandler(async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR');

  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.demoteToLevel1(
    req.params.id,
    req.user.id,
    req.user.role,
    reason,
    adminNote
  );
  return res.status(200).json({ msg: `تم خفض ${user.name}`, user });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  res.json(result);
});

exports.banUser = asyncHandler(async (req, res) => {
  const targetUserId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    throw new AppError('قيمة المعرف ممررة بشكل غير صالح', 400, 'INVALID_ID');
  }
  const objectIdTarget = new mongoose.Types.ObjectId(targetUserId);

  const reason    = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.banUser(
    targetUserId,
    req.user.id,
    req.user.role,
    reason,
    adminNote
  );

  // ── Cascade Ban ─────────────────────────────────────────────
  await Item.updateMany(
    { donor: objectIdTarget, status: 'متاح' },
    { $set: { status: 'ملغى' } }
  );
  await Item.updateMany(
    { donor: objectIdTarget, status: 'محجوز' },
    { $set: { status: 'ملغى', bookedBy: null, bookedAt: null } }
  );
  await Item.updateMany(
    { bookedBy: objectIdTarget, status: 'محجوز' },
    { $set: { status: 'متاح', bookedBy: null, bookedAt: null, recipientConfirmed: false, donorConfirmed: false } }
  );
  await Item.updateMany(
    { waitlist: objectIdTarget },
    { $pull: { waitlist: objectIdTarget } }
  );

  // ── Socket Disconnect ────────────────────────────────────────
  try {
    const io            = getIO();
    const activeSockets = await io.in(`user_${targetUserId}`).fetchSockets();
    activeSockets.forEach((socket) => {
      socket.emit('auth:forced_logout', { msg: 'تم حظر حسابك من قبل الإدارة 🚫' });
      socket.disconnect(true);
    });
  } catch (socketErr) {
    console.warn('[Socket Ban Cleanup] تعذر الاتصال بالسوكت:', socketErr.message);
  }

  res.json({
    msg: `تم حظر ${user.name} وتطهير كافة حجوزاته وجلساته النشطة بنجاح 🚫`,
    user,
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
  res.json({ msg: `تم رفع الحظر عن ${user.name}`, user });
});

// ─── Items ────────────────────────────────────────────────────
exports.listItems = asyncHandler(async (req, res) => {
  const result = await adminService.listItems(req.query);
  res.json(result);
});

exports.deleteItem = asyncHandler(async (req, res) => {
  const adminNote = cleanString(req.body.adminNote);
  if (!adminNote) throw new AppError('تعليق الحذف مطلوب', 400, 'ADMIN_NOTE_REQUIRED');

  await adminService.deleteItem(req.params.id, req.user.id, adminNote);
  res.json({ msg: 'تم حذف الغرض ✅' });
});

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = asyncHandler(async (req, res) => {
  // ✅ FIX BUG-06: لا default — null يعني "كل الحالات"
  const { page = 1, status } = req.query;

  const ALLOWED_STATUSES = ['pending', 'actioned', 'dismissed', 'reviewed'];
  // إذا لم تُرسَل status أو كانت خارج القائمة → null = جميع الحالات
  const safeStatus = ALLOWED_STATUSES.includes(status) ? status : null;

  const result = await adminService.listReports({ page, status: safeStatus });
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
