// services/adminService.js
const adminRepo        = require('../repositories/adminRepository');
const reportRepository = require('../repositories/reportRepository');
const userRepository   = require('../repositories/userRepository');
const AdminLog         = require('../models/AdminLog');
const User             = require('../models/User');
const Item             = require('../models/Item');
const SystemSettings   = require('../models/SystemSettings');
const notifyUser       = require('../utils/notifyUser');
const { deleteFromCloudinary } = require('../utils/uploadToCloudinary');
const AppError         = require('../utils/AppError');
const sessionCache     = require('../utils/sessionCache');
const { SOCKET_EVENTS } = require('../socket/contracts');
const { disconnectUserSockets, emitToUser } = require('../socket/emitter');
const adminDto = require('../dtos/adminDto');

const notifyBestEffort = async (user, payload, context) => {
  try {
    await notifyUser(user, payload);
  } catch (error) {
    console.warn(`[Admin Notification][${context}] ${error.message}`);
  }
};

const assertCanManageUser = async (targetId, actorId, actorRole) => {
  const target = await userRepository.findByIdForAdmin(targetId);
  if (!target) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (String(targetId) === String(actorId)) {
    throw new AppError('لا يمكنك تنفيذ هذا الإجراء على حسابك', 400, 'CANNOT_MODERATE_SELF');
  }
  if (target.role === 'super_admin') {
    throw new AppError('لا يمكن تعديل حساب المشرف الأعلى', 403, 'SUPER_ADMIN_PROTECTED');
  }
  if (target.role === 'admin' && actorRole !== 'super_admin') {
    throw new AppError(
      'إدارة حسابات المشرفين تتطلب صلاحية المشرف الأعلى',
      403,
      'SUPER_ADMIN_REQUIRED'
    );
  }
  return target;
};

const applyBanConsequences = async (userId) => {
  await Promise.all([
    Item.updateMany(
      { donor: userId, status: { $in: ['متاح', 'محجوز'] } },
      {
        $set: {
          status: 'مخفي',
          bookedBy: null,
          bookedAt: null,
          recipientConfirmed: false,
          donorConfirmed: false,
          recipientConfirmedAt: null,
          donorConfirmedAt: null,
        },
      }
    ),
    Item.updateMany(
      { bookedBy: userId, status: 'محجوز' },
      {
        $set: {
          status: 'متاح',
          bookedBy: null,
          bookedAt: null,
          recipientConfirmed: false,
          donorConfirmed: false,
          recipientConfirmedAt: null,
          donorConfirmedAt: null,
        },
      }
    ),
    Item.updateMany(
      { 'waitlist.user': userId },
      { $pull: { waitlist: { user: userId } } }
    ),
  ]);

  try {
    await disconnectUserSockets(userId, {
      code: 'ACCOUNT_BANNED',
      msg: 'تم حظر حسابك من قبل الإدارة 🚫',
    });
  } catch (error) {
    console.warn('[Socket Ban Cleanup] تعذر إنهاء اتصالات المستخدم:', error.message);
  }
};

// ─── Stats ────────────────────────────────────────────────────
exports.getStats = () => adminRepo.getDashboardStats();

// ─── Users ────────────────────────────────────────────────────
exports.listUsers = async ({ page = 1, search = '', banned = '' }) => {
  const normalizedPage = Math.max(1, +page || 1);
  const settings  = await SystemSettings.getCached();
  const PAGE_SIZE = settings?.adminPageSize ?? 20;

  const [users, total] = await Promise.all([
    adminRepo.findAllUsers({ page: normalizedPage, search, banned, limit: PAGE_SIZE }),
    adminRepo.countUsers({ search, banned }),
  ]);
  return {
    users: users.map(adminDto.toAdminUser).filter(Boolean),
    total,
    page: normalizedPage,
    pages: Math.ceil(total / PAGE_SIZE),
  };
};

exports.banUser = async (userId, adminId, adminRole, reason, adminNote) => {
  await assertCanManageUser(userId, adminId, adminRole);
  const user = await adminRepo.banUser(userId, reason, adminId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  await notifyBestEffort(user, {
    type:  'admin_ban',
    title: 'تم حظر حسابك',
    body:  reason
      ? `حظرت الإدارة حسابك. السبب: ${reason}`
      : 'حظرت الإدارة حسابك بسبب مخالفة سياسات المنصة.',
  }, 'ban');

  await userRepository.invalidateUserSession(userId);
  sessionCache.invalidate(userId);
  await applyBanConsequences(userId);

  await adminRepo.logAdminAction({
    adminId, action: 'BAN', targetId: userId, targetModel: 'User',
    targetName: user.name, reason: reason ?? 'حظر يدوي', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null },
  });

  return user;
};

exports.unbanUser = async (userId, adminId, adminRole, adminNote = null) => {
  await assertCanManageUser(userId, adminId, adminRole);
  const user = await adminRepo.unbanUser(userId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  sessionCache.invalidate(userId);

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
  const settings  = await SystemSettings.getCached();
  const PAGE_SIZE = settings?.adminPageSize ?? 20;

  const [items, total] = await Promise.all([
    adminRepo.findAllItems({ page: normalizedPage, limit: PAGE_SIZE }),
    adminRepo.countItems(),
  ]);
  return {
    items: items.map(adminDto.toAdminItem).filter(Boolean),
    total,
    page: normalizedPage,
    pages: Math.ceil(total / PAGE_SIZE),
  };
};

exports.deleteItem = async (itemId, adminId, adminNote) => {
  const item = await Item.findById(itemId).populate('donor', 'name email');
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const donorName  = item.donor?.name  ?? null;
  const donorEmail = item.donor?.email ?? null;
  const itemTitle  = item.title        ?? 'غرض محذوف';

  await Item.deleteOne({ _id: itemId });

  if (item.cloudinaryId) {
    try {
      await deleteFromCloudinary(item.cloudinaryId);
    } catch (err) {
      console.warn('[Admin Items] تعذر حذف صورة الغرض من Cloudinary:', err.message);
    }
  }

  const affectedUserIds = [
    item.donor?._id ?? item.donor,
    item.bookedBy,
    ...(item.waitlist ?? []).map((entry) => entry.user),
  ].filter(Boolean);
  const uniqueAffectedUserIds = [
    ...new Map(affectedUserIds.map((id) => [id.toString(), id])).values(),
  ];
  for (const userId of uniqueAffectedUserIds) {
    emitToUser(userId, SOCKET_EVENTS.ITEM_DELETED, { itemId: item._id });
  }
  await Promise.allSettled(
    uniqueAffectedUserIds.map((userId) => notifyUser(userId, {
      type:   'item_deleted_by_admin',
      title:  'تم حذف غرض من الإدارة',
      body:   `حذفت الإدارة الغرض "${itemTitle}" ولم يعد متاحاً.`,
      itemId: null,
    }))
  );

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
  const settings = await SystemSettings.getCached();
  const LIMIT    = settings?.adminReportsPageSize ?? 10;

  // ✅ FIX [ADMIN-REPORT-02]: تعقيم status — string فارغة → null
  const cleanStatus = status || null;

  const { reports, total } = await adminRepo.findPendingReportsWithCounts({
    page:   normalizedPage,
    limit:  LIMIT,
    status: cleanStatus,
    repeatOffenderThreshold: settings.autoReportBanThreshold ?? 5,
  });

  return {
    reports,
    total,
    page:       normalizedPage,
    totalPages: Math.ceil(total / LIMIT),
  };
};

exports.resolveReport = async (
  reportId,
  adminId,
  adminRole,
  status,
  adminNote = null
) => {
  const allowedStatuses = ['actioned', 'reviewed', 'dismissed'];
  if (!allowedStatuses.includes(status))
    throw new AppError('حالة غير صالحة للبلاغ', 400, 'INVALID_REPORT_STATUS');

  const existingReport = await reportRepository.findByIdPopulated(reportId);
  if (!existingReport) {
    throw new AppError('البلاغ غير موجود', 404, 'REPORT_NOT_FOUND');
  }
  if (existingReport.status !== 'pending') {
    throw new AppError('تم البت في هذا البلاغ مسبقاً', 409, 'REPORT_ALREADY_RESOLVED');
  }

  const report = await adminRepo.resolvePendingReport(
    reportId,
    adminId,
    status,
    adminNote
  );
  if (!report) {
    throw new AppError(
      'سبق لمشرف آخر البت في هذا البلاغ',
      409,
      'REPORT_RESOLUTION_CONFLICT'
    );
  }

  const fullReport = await reportRepository.findByIdPopulated(reportId);

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

  const reporterMessage = {
    actioned:  'تمت مراجعة بلاغك واتخاذ إجراء مناسب.',
    reviewed:  'تمت مراجعة بلاغك وإغلاقه بعد التحقق.',
    dismissed: 'تمت مراجعة بلاغك ولم يتم اعتماد إجراء عليه.',
  }[status];

  if (fullReport?.reporter?._id) {
    await notifyBestEffort(fullReport.reporter, {
      type:      'report_resolved',
      title:     'تمت معالجة بلاغك',
      body:      reporterMessage,
      itemId:    fullReport?.relatedItem?._id ?? null,
      actionUrl: '/dashboard',
      metadata:  { reportId: String(reportId), status },
    }, 'report-resolution');
  }

  if (status === 'actioned' && report.reportedUser) {
    await notifyBestEffort(fullReport?.reportedUser ?? report.reportedUser, {
      type:   'admin_warning',
      title:  'تحذير من الإدارة',
      body:   '⚠️ اتخذت الإدارة إجراءً بسبب بلاغ مقدم ضدك.',
      itemId: fullReport?.relatedItem?._id ?? null,
      actionUrl: '/dashboard',
      metadata: { reportId: String(reportId), status },
    }, 'report-warning');

    const settings = await SystemSettings.getCached();
    const threshold = settings.autoReportBanThreshold ?? 5;
    const actionedCount = await reportRepository.countActionedByReportedUser(
      report.reportedUser
    );
    const target = fullReport?.reportedUser;

    if (
      actionedCount >= threshold
      && target
      && !target.isBanned
      && target.role === 'user'
    ) {
      await exports.banUser(
        report.reportedUser,
        adminId,
        adminRole,
        `حظر تلقائي بعد اعتماد ${actionedCount} بلاغات`,
        `عتبة الحظر التلقائي المضبوطة: ${threshold}`
      );
    }
  }

  return fullReport ?? report;
};

exports.applyBanConsequences = applyBanConsequences;

// ─── Audit Logs ───────────────────────────────────────────────
exports.listAuditLogs = async ({ page = 1 }) => {
  const normalizedPage = Math.max(1, +page || 1);
  const settings  = await SystemSettings.getCached();
  const PAGE_SIZE = settings?.adminPageSize ?? 20;

  const [logs, total] = await Promise.all([
    adminRepo.findAdminLogs({ page: normalizedPage, limit: PAGE_SIZE }),
    AdminLog.countDocuments(),
  ]);
  return {
    logs: logs.map(adminDto.toAdminAuditLog).filter(Boolean),
    total,
    page: normalizedPage,
    pages: Math.ceil(total / PAGE_SIZE),
  };
};

// ─── Promote / Demote ─────────────────────────────────────────
exports.promoteToLevel2 = async (targetId, adminId, adminRole, reason = null, adminNote = null) => {
  const user = await assertCanManageUser(targetId, adminId, adminRole);
  if (user.isBanned) throw new AppError('لا يمكن ترقية مستخدم محظور', 403, 'USER_BANNED');
  if (user.trustLevel !== 1) throw new AppError(
    `لا يمكن الترقية اليدوية — مستوى المستخدم الحالي هو ${user.trustLevel}`,
    400, 'MANUAL_PROMOTE_RESTRICTED'
  );

  const settings    = await SystemSettings.getCached();
  const level2Quota = settings?.level2Quota ?? 4;

  const updated = await userRepository.setTrustLevelAndQuota(targetId, 2, level2Quota);
  sessionCache.invalidate(targetId);

  await adminRepo.logAdminAction({
    adminId, action: 'PROMOTE', targetId, targetModel: 'User',
    targetName: user.name, reason: reason ?? 'ترقية يدوية', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null, fromLevel: user.trustLevel, toLevel: 2 },
  });

  return updated;
};

exports.demoteToLevel1 = async (targetId, adminId, adminRole, reason = null, adminNote = null) => {
  const user = await assertCanManageUser(targetId, adminId, adminRole);
  if (user.trustLevel === 1) throw new AppError('المستخدم في المستوى 1 بالفعل', 400, 'ALREADY_LEVEL1');

  const settings     = await SystemSettings.getCached();
  const defaultQuota = settings?.defaultUserQuota ?? 2;

  const updated = await userRepository.setTrustLevelAndQuota(targetId, 1, defaultQuota);
  sessionCache.invalidate(targetId);

  await adminRepo.logAdminAction({
    adminId, action: 'DEMOTE', targetId, targetModel: 'User',
    targetName: user.name, reason: reason ?? 'تخفيض يدوي', adminNote: adminNote ?? null,
    meta: { targetName: user.name, targetEmail: user.email ?? null, fromLevel: user.trustLevel, toLevel: 1 },
  });

  return updated;
};
