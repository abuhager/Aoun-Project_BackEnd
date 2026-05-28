// services/adminService.js
const adminRepo = require('../repositories/adminRepository');
const userRepository = require('../repositories/userRepository');
const AdminLog  = require('../models/AdminLog');

// ─── Stats ────────────────────────────────────────────────────
exports.getStats = () => adminRepo.getDashboardStats();

// ─── Users ────────────────────────────────────────────────────
exports.listUsers = async ({ page = 1, search = '', banned = '' }) => {
  // فلترة isBanned
  const [users, total] = await Promise.all([
    adminRepo.findAllUsers({ page: +page, search }),
    adminRepo.countUsers(search),
  ]);
  return { users, total, page: +page, pages: Math.ceil(total / 20) };
};

exports.banUser = async (userId, adminId, reason) => {
  const user = await adminRepo.banUser(userId, reason, adminId);
  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  await adminRepo.logAdminAction({ adminId, action: 'ban_user', targetId: userId, targetModel: 'User', details: reason });
  return user;
};

exports.unbanUser = async (userId, adminId) => {
  const user = await adminRepo.unbanUser(userId);
  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  await adminRepo.logAdminAction({ adminId, action: 'unban_user', targetId: userId, targetModel: 'User' });
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
  await adminRepo.logAdminAction({ adminId, action: 'delete_item', targetId: itemId, targetModel: 'Item' });
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
  const report = await adminRepo.resolveReport(reportId, adminId, action);
  if (!report) throw Object.assign(new Error('البلاغ غير موجود'), { status: 404 });
  await adminRepo.logAdminAction({ adminId, action: `resolve_report:${action}`, targetId: reportId, targetModel: 'Report' });
  return report;
};

// ─── Audit Logs ───────────────────────────────────────────────
exports.listAuditLogs = async ({ page = 1 }) => {
  const AdminLog = require('../models/AdminLog');
  const [logs, total] = await Promise.all([
    adminRepo.findAdminLogs({ page: +page }),
    AdminLog.countDocuments(),
  ]);
  return { logs, total, page: +page, pages: Math.ceil(total / 20) };
};

exports.promoteToLevel2 = async (targetId, adminId, reason = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);

  if (!user)              throw Object.assign(new Error('المستخدم غير موجود'),              { status: 404, code: 'USER_NOT_FOUND'  });
  if (user.isBanned)      throw Object.assign(new Error('لا يمكن ترقية مستخدم محظور'),      { status: 403, code: 'USER_BANNED'     });
  if (user.trustLevel>=2) throw Object.assign(new Error('المستخدم في المستوى 2 بالفعل ✅'), { status: 400, code: 'ALREADY_LEVEL2'  });

  const updated = await userRepository.setTrustLevel(targetId, 2);

  // ✅ سجّل العملية — يُستخدم في Phase 6
  await AdminLog.create({ adminId, targetId, action: 'PROMOTE', reason });

  return updated;
};

exports.demoteToLevel1 = async (targetId, adminId, reason = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);

  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404, code: 'USER_NOT_FOUND' });

  if (user.isVerifiedStudent || user.phoneVerified) {
    throw Object.assign(
      new Error('لا يمكن خفض مستخدم وصل Level 2 تلقائياً'),
      { status: 403, code: 'AUTO_VERIFIED_PROTECTED' }
    );
  }

  if (user.trustLevel < 2) throw Object.assign(new Error('المستخدم في المستوى 1 بالفعل'), { status: 400, code: 'ALREADY_LEVEL1' });

  const updated = await userRepository.setTrustLevel(targetId, 1);

  await AdminLog.create({ adminId, targetId, action: 'DEMOTE', reason });

  return updated;
};