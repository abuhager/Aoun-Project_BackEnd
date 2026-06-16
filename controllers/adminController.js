// controllers/adminController.js
const mongoose = require('mongoose'); // أُضيف لاستخدامه في تحويل وتأكيد الـ ObjectIds الصريحة
const adminService = require('../services/adminService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { validatePromote } = require('../dtos/adminDto');

// استيراد الموديلات المطلوبة للـ Cascade Cleanup عند الحظر
const Item = require('../models/Item');
const { getIO } = require('../socket'); 

// ─── ميثود مساعدة لتنظيف النصوص ──────────────────────────────
const cleanString = (str) => (typeof str === 'string' ? str.trim() : '');

// ─── Users ────────────────────────────────────────────────────
exports.promoteUser = asyncHandler(async (req, res) => {
  const { error } = validatePromote(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR');
  }

  // تأمين البيانات النصية لضمان عدم تمرير حقول مشوهة أو فارغة
  const reason = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.promoteToLevel2(
    req.params.id,
    req.user.id,
    reason,
    adminNote
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

  const reason = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.demoteToLevel1(
    req.params.id,
    req.user.id,
    reason,
    adminNote
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
  const targetUserId = req.params.id;

  // 1. التحقق من صحة المعرّف وتحويله إلى ObjectId صريح لمنع خطأ الـ CastError في الـ waitlist
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    throw new AppError('قيمة المعرف ممررة بشكل غير صالح', 400, 'INVALID_ID');
  }
  const objectIdTarget = new mongoose.Types.ObjectId(targetUserId);

  const reason = cleanString(req.body.reason);
  const adminNote = cleanString(req.body.adminNote);

  // تنفيذ الحظر الأساسي وتحديث الـ tokens عبر الـ Service
  const user = await adminService.banUser(
    targetUserId,
    req.user.id,
    reason,
    adminNote
  );

  // ✅ 2. منطق الحظر المتتالي (Cascade Ban) باستخدام الـ ObjectId الصريح لحماية الـ Queries:
  
  // أ) إذا كان المحظور هو (المتبرع): إخفاء أغراضه المعروضة بالكامل لمنع حجزها
  await Item.updateMany(
    { donor: objectIdTarget, status: 'متاح' },
    { $set: { status: 'ملغى' } }
  );

  // ب) إذا كان المحظور هو (المتبرع) ولديه قطع "محجوزة" لم تُسلم بعد: نلغي حجزها ونخفيها
  await Item.updateMany(
    { donor: objectIdTarget, status: 'محجوز' },
    { $set: { status: 'ملغى', bookedBy: null, bookedAt: null } }
  );

  // جـ) إذا كان المحظور هو (الحاجز): تحرير الأغراض التي حجزها وإعادتها "متاحة" فوراً للجميع
  await Item.updateMany(
    { bookedBy: objectIdTarget, status: 'محجوز' },
    { $set: { status: 'متاح', bookedBy: null, bookedAt: null, recipientConfirmed: false, donorConfirmed: false } }
  );

  // د) سحب المستخدم المحظور من كافة قوائم الانتظار (Waitlists) في جميع الأغراض (تم الإصلاح هنا 🛠️)
  await Item.updateMany(
    { waitlist: objectIdTarget },
    { $pull: { waitlist: objectIdTarget } }
  );

  // ✅ 3. طرد المستخدم فوراً من جلسة الـ Socket الحية (Real-time Socket Disconnect)
  try {
    const io = getIO();
    const userRoom = `user_${targetUserId}`;
    const activeSockets = await io.in(userRoom).fetchSockets();
    
    activeSockets.forEach((socket) => {
      socket.emit('auth:forced_logout', { msg: 'تم حظر حسابك من قبل الإدارة 🚫' });
      socket.disconnect(true);
    });
  } catch (socketErr) {
    console.warn('[Socket Ban Cleanup] تعذر الاتصال بالسوكت لطرد المستخدم:', socketErr.message);
  }

  res.json({
    msg: `تم حظر ${user.name} وتطهير كافة حجوزاته وجلساته النشطة بنجاح 🚫`,
    user,
  });
});

exports.unbanUser = asyncHandler(async (req, res) => {
  const adminNote = cleanString(req.body.adminNote);

  const user = await adminService.unbanUser(
    req.params.id,
    req.user.id,
    adminNote
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
  const adminNote = cleanString(req.body.adminNote);
  if (!adminNote) {
    throw new AppError('تعليق الحذف مطلوب', 400, 'ADMIN_NOTE_REQUIRED');
  }

  await adminService.deleteItem(
    req.params.id,
    req.user.id,
    adminNote
  );

  res.json({ msg: 'تم حذف الغرض ✅' });
});

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = asyncHandler(async (req, res) => {
  const { page = 1, status = 'pending' } = req.query;

  const ALLOWED_STATUSES = ['pending', 'actioned', 'dismissed', 'reviewed'];
  const safeStatus = ALLOWED_STATUSES.includes(status) ? status : 'pending';

  const result = await adminService.listReports({ page, status: safeStatus });
  res.json(result);
});

exports.resolveReport = asyncHandler(async (req, res) => {
  const action = cleanString(req.body.action);
  const adminNote = cleanString(req.body.adminNote);

  const report = await adminService.resolveReport(
    req.params.id,
    req.user.id,
    action,
    req.user.name,
    adminNote
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