// services/adminService.js
const adminRepo      = require('../repositories/adminRepository');
const userRepository = require('../repositories/userRepository');
const AdminLog       = require('../models/AdminLog');
const { notifyUser } = require('../utils/notifyUser');
// ─── Stats ────────────────────────────────────────────────────
exports.getStats = () => adminRepo.getDashboardStats();

// ─── Users ────────────────────────────────────────────────────
exports.listUsers = async ({ page = 1, search = '', banned = '' }) => {
  const [users, total] = await Promise.all([
    adminRepo.findAllUsers({ page: +page, search }),
    adminRepo.countUsers(search),
  ]);
  return { users, total, page: +page, pages: Math.ceil(total / 20) };
};

exports.banUser = async (userId, adminId, reason) => {
  const user = await adminRepo.banUser(userId, reason, adminId);
  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  await adminRepo.logAdminAction({
    adminId, action: 'BAN',          // ✅ كان 'ban_user'
    targetId: userId, targetModel: 'User', reason,
  });
  return user;
};

exports.unbanUser = async (userId, adminId) => {
  const user = await adminRepo.unbanUser(userId);
  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  await adminRepo.logAdminAction({
    adminId, action: 'UNBAN',        // ✅ كان 'unban_user'
    targetId: userId, targetModel: 'User',
  });
  return user;
};

// ─── Items ────────────────────────────────────────────────────
exports.listItems = async ({ page = 1 }) => {
  const [items, total] = await Promise.all([
    adminRepo.findAllItems({ page: +page }),
    adminRepo.countItems(),
  ]);
  return { items, total, page: +page, pages: Math.ceil(total / 20) };
};

exports.deleteItem = async (itemId, adminId) => {
  const Item = require('../models/Item');
  const item = await Item.findByIdAndDelete(itemId);
  if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });
  await adminRepo.logAdminAction({
    adminId, action: 'ITEM_HIDE',    // ✅ كان 'delete_item' — مش في الـ enum
    targetId: itemId, targetModel: 'Item',
  });
  return item;
};

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = async ({ page = 1 }) => {
  const Report = require('../models/Report');
  const [reports, total] = await Promise.all([
    adminRepo.findPendingReports({ page: +page }),
    Report.countDocuments({ status: 'pending' }),
  ]);
  return { reports, total, page: +page, pages: Math.ceil(total / 20) };
};

exports.resolveReport = async (reportId, adminId, action) => {
  const statusMap = {
    warn:    'actioned',
    ban:     'actioned',
    dismiss: 'dismissed',
  };
  const newStatus = statusMap[action] ?? 'reviewed';
  const report = await adminRepo.resolveReport(reportId, adminId, newStatus);
  if (!report) throw Object.assign(new Error('البلاغ غير موجود'), { status: 404 });

  await adminRepo.logAdminAction({
    adminId, action: 'REPORT_ACTION',
    targetId: reportId, targetModel: 'Report', reason: action,
  });

  // ✅ إرسال notification للمُبلَّغ عنه
  if (action === 'warn' && report.reportedUser) {
    await notifyUser(report.reportedUser, {
      type:    'warning',
      message: '⚠️ تلقيت تحذيراً من الإدارة بسبب بلاغ مقدم ضدك. يرجى الالتزام بقوانين المنصة.',
    });
  }

  if (action === 'ban' && report.reportedUser) {
    await adminRepo.banUser(report.reportedUser, 'حظر من بلاغ مؤكد', adminId);
    await notifyUser(report.reportedUser, {
      type:    'ban',
      message: '🚫 تم حظر حسابك من قبل الإدارة.',
    });
    await adminRepo.logAdminAction({
      adminId, action: 'BAN',
      targetId: report.reportedUser, targetModel: 'User',
      reason: 'حظر تلقائي من معالجة بلاغ',
    });
  }

  return report;
};

// ─── Audit Logs ───────────────────────────────────────────────
exports.listAuditLogs = async ({ page = 1 }) => {
  const [logs, total] = await Promise.all([
    adminRepo.findAdminLogs({ page: +page }),
    AdminLog.countDocuments(),
  ]);
  return { logs, total, page: +page, pages: Math.ceil(total / 20) };
};

// ─── Promote / Demote ─────────────────────────────────────────
exports.promoteToLevel2 = async (targetId, adminId, reason = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);

  if (!user)              throw Object.assign(new Error('المستخدم غير موجود'),              { status: 404, code: 'USER_NOT_FOUND' });
  if (user.isBanned)      throw Object.assign(new Error('لا يمكن ترقية مستخدم محظور'),      { status: 403, code: 'USER_BANNED'    });
  if (user.trustLevel>=2) throw Object.assign(new Error('المستخدم في المستوى 2 بالفعل ✅'), { status: 400, code: 'ALREADY_LEVEL2' });

  const updated = await userRepository.setTrustLevel(targetId, 2);
  await AdminLog.create({ adminId, targetId, action: 'PROMOTE', reason });
  return updated;
};

exports.demoteToLevel1 = async (targetId, adminId, reason = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);

  if (!user) throw Object.assign(
    new Error('المستخدم غير موجود'), { status: 404 }
  );

  if (user.trustLevel < 2) throw Object.assign(
    new Error('المستخدم في المستوى 1 بالفعل'), { status: 400 }
  );

  const updated = await userRepository.setTrustLevel(targetId, 1);
  await AdminLog.create({ adminId, targetId, action: 'DEMOTE', reason });
  return updated;
};