// services/adminService.js
const adminRepo      = require('../repositories/adminRepository');
const userRepository = require('../repositories/userRepository');
const AdminLog       = require('../models/AdminLog');
const User           = require('../models/User');
const SystemSettings = require('../models/SystemSettings');
const notifyUser     = require('../utils/notifyUser');
const AppError       = require('../utils/AppError');
const sessionCache   = require('../utils/sessionCache');

// ─── Stats ────────────────────────────────────────────────────
exports.getStats = () => adminRepo.getDashboardStats();

// ─── Users ────────────────────────────────────────────────────
exports.listUsers = async ({ page = 1, search = '', banned = '' }) => {
  const normalizedPage = Math.max(1, +page || 1);
  // ✅ FIX [HC-ADMIN-01]: adminPageSize ديناميكي بدل 20 ثابت
  const settings  = await SystemSettings.getCached();
  const PAGE_SIZE = settings?.adminPageSize ?? 20;

  const [users, total] = await Promise.all([
    adminRepo.findAllUsers({ page: normalizedPage, search, banned, limit: PAGE_SIZE }),
    adminRepo.countUsers({ search, banned }),
  ]);
  return { users, total, page: normalizedPage, pages: Math.ceil(total / PAGE_SIZE) };
};

exports.banUser = async (userId, adminId, reason, adminNote) => {
  const user = await adminRepo.banUser(userId, reason, adminId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  await User.findByIdAndUpdate(userId, { $inc: { refreshTokenVersion: 1 } });
  sessionCache.invalidate(userId);

  await adminRepo.logAdminAction({
    adminId, action: 'BAN', targetId: userId, targetModel: 'User',
    targetName: user.name, reason: reason ?? 'حظر يدوي', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null },
  });

  return user;
};

exports.unbanUser = async (userId, adminId, adminNote = null) => {
  const user = await adminRepo.unbanUser(userId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  await adminRepo.logAdminAction({
    adminId, action: 'UNBAN', targetId: userId, targetModel: 'User',
    targetName: user.name, reason: 'رفع الحظر يدوياً من الأدمن', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null },
  });

  return user;
};

// ─── Items ────────────────────────────────────────────────────
exports.listItems = async ({ page = 1 }) => {
  const normalizedPage = Math.max(1, +page || 1);
  // ✅ FIX [HC-ADMIN-01]: adminPageSize ديناميكي بدل 20 ثابت
  const settings  = await SystemSettings.getCached();
  const PAGE_SIZE = settings?.adminPageSize ?? 20;

  const [items, total] = await Promise.all([
    adminRepo.findAllItems({ page: normalizedPage, limit: PAGE_SIZE }),
    adminRepo.countItems(),
  ]);
  return { items, total, page: normalizedPage, pages: Math.ceil(total / PAGE_SIZE) };
};

exports.deleteItem = async (itemId, adminId, adminNote) => {
  const Item = require('../models/Item');
  const item = await Item.findById(itemId).populate('donor', 'name email');
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const donorName  = item.donor?.name  ?? null;
  const donorEmail = item.donor?.email ?? null;
  const itemTitle  = item.title        ?? 'غرض محذوف';

  await Item.deleteOne({ _id: itemId });

  await adminRepo.logAdminAction({
    adminId, action: 'ITEM_HIDE', targetId: itemId, targetModel: 'Item',
    targetName: donorName ?? itemTitle, reason: 'حذف غرض من لوحة الإدارة',
    adminNote: adminNote ?? null,
    meta: { targetName: donorName ?? itemTitle, targetEmail: donorEmail, itemTitle },
  });

  return item;
};

// ─── Reports ──────────────────────────────────────────────────
exports.listReports = async ({ page = 1, status = null } = {}) => {
  const normalizedPage = Math.max(1, +page || 1);
  // ✅ FIX [HC-ADMIN-02]: adminReportsPageSize ديناميكي بدل LIMIT = 10 ثابت
  const settings = await SystemSettings.getCached();
  const LIMIT    = settings?.adminReportsPageSize ?? 10;

  const { reports, total } = await adminRepo.findPendingReportsWithCounts({
    page: normalizedPage,
    limit: LIMIT,
    status,
  });

  return {
    reports,
    total,
    page:       normalizedPage,
    totalPages: Math.ceil(total / LIMIT),
  };
};
exports.resolveReport = async (reportId, adminId, status, adminNote = null) => {
  // ✅ FIX BUG-01: قبول status مباشرة بدلاً من action
  const allowedStatuses = ['actioned', 'reviewed', 'dismissed'];
  if (!allowedStatuses.includes(status)) {
    throw new AppError('حالة غير صالحة للبلاغ', 400, 'INVALID_REPORT_STATUS');
  }

  // ✅ FIX BUG-04: تمرير adminNote ليُحفَظ في الـ document
  const report = await adminRepo.resolveReport(reportId, adminId, status, adminNote);
  if (!report) throw new AppError('البلاغ غير موجود', 404, 'REPORT_NOT_FOUND');

  const Report     = require('../models/Report');
  const fullReport = await Report.findById(reportId)
    .populate('reportedUser', 'name email isBanned')
    .populate('reporter',     'name email')
    .populate('relatedItem',  'title');

  const statusLabel = {
    actioned:  'تم الإجراء',
    reviewed:  'تمّت المراجعة',
    dismissed: 'تم الرفض',
  }[status];

  await adminRepo.logAdminAction({
    adminId,
    action:      'REPORT_ACTION',
    targetId:    reportId,
    targetModel: 'Report',
    reason:      statusLabel,
    adminNote:   adminNote ?? null,
    meta: {
      targetName:       fullReport?.reportedUser?.name  ?? '—',
      reportedBy:       fullReport?.reporter?.name      ?? '—',
      reason:           fullReport?.reason              ?? '—',
      action:           statusLabel,
      relatedItemTitle: fullReport?.relatedItem?.title  ?? null,
    },
  });

  // ✅ إشعار فقط عند "actioned" — هو الوحيد ذو أثر على المستخدم
  if (status === 'actioned' && report.reportedUser) {
    await notifyUser(report.reportedUser, {
      type:   'admin_warning',
      title:  'تحذير من الإدارة',
      body:   '⚠️ اتخذت الإدارة إجراءً بسبب بلاغ مقدم ضدك.',
      itemId: fullReport?.relatedItem?._id ?? null,
    });
  }

  return report;
};

// ─── Audit Logs ───────────────────────────────────────────────
exports.listAuditLogs = async ({ page = 1 }) => {
  const normalizedPage = Math.max(1, +page || 1);
  // ✅ FIX [HC-ADMIN-01]: adminPageSize ديناميكي بدل 20 ثابت
  const settings  = await SystemSettings.getCached();
  const PAGE_SIZE = settings?.adminPageSize ?? 20;

  const [logs, total] = await Promise.all([
    adminRepo.findAdminLogs({ page: normalizedPage, limit: PAGE_SIZE }),
    AdminLog.countDocuments(),
  ]);
  return { logs, total, page: normalizedPage, pages: Math.ceil(total / PAGE_SIZE) };
};

// ─── Promote / Demote ─────────────────────────────────────────
exports.promoteToLevel2 = async (targetId, adminId, reason = null, adminNote = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (user.isBanned) throw new AppError('لا يمكن ترقية مستخدم محظور', 403, 'USER_BANNED');
  if (user.trustLevel !== 1) throw new AppError(
    `لا يمكن الترقية اليدوية — مستوى المستخدم الحالي هو ${user.trustLevel}`,
    400, 'MANUAL_PROMOTE_RESTRICTED'
  );

  const settings    = await SystemSettings.getCached();
  const level2Quota = settings?.level2Quota ?? 4;

  const updated = await userRepository.setTrustLevelAndQuota(targetId, 2, level2Quota);

  await adminRepo.logAdminAction({
    adminId, action: 'PROMOTE', targetId, targetModel: 'User',
    targetName: user.name, reason: reason ?? 'ترقية يدوية', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null, fromLevel: user.trustLevel, toLevel: 2 },
  });

  return updated;
};

exports.demoteToLevel1 = async (targetId, adminId, reason = null, adminNote = null) => {
  const user = await userRepository.findByIdForAdmin(targetId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (user.trustLevel === 1) throw new AppError('المستخدم في المستوى 1 بالفعل', 400, 'ALREADY_LEVEL1');

  const settings     = await SystemSettings.getCached();
  const defaultQuota = settings?.defaultUserQuota ?? 2;

  const updated = await userRepository.setTrustLevelAndQuota(targetId, 1, defaultQuota);

  await adminRepo.logAdminAction({
    adminId, action: 'DEMOTE', targetId, targetModel: 'User',
    targetName: user.name, reason: reason ?? 'تخفيض يدوي', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null, fromLevel: user.trustLevel, toLevel: 1 },
  });

  return updated;
};