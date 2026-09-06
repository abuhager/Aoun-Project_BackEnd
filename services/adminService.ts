import adminRepo from '../repositories/adminRepository.js';
import reportRepository from '../repositories/reportRepository.js';
import userRepository from '../repositories/userRepository.js';
import AdminLog from '../models/AdminLog.js';
import User from '../models/User.js';
import Item from '../models/Item.js';
import SystemSettings from '../models/SystemSettings.js';
import notifyUser from '../utils/notifyUser.js';
import { deleteFromCloudinary } from '../utils/uploadToCloudinary.js';
import AppError from '../utils/AppError.js';
import sessionCache from '../utils/sessionCache.js';
import { SOCKET_EVENTS } from '../socket/contracts.js';
import { disconnectUserSockets, emitToUser } from '../socket/emitter.js';
import adminDto from '../dtos/adminDto.js';
import type { EntityId, ServicePayload, ServiceRecord } from './serviceTypes.js';
import { getErrorMessage } from './serviceTypes.js';

export type AdminRole = 'admin' | 'super_admin';
type ReportResolutionStatus = 'actioned' | 'reviewed' | 'dismissed';
type WaitlistEntry = { user: EntityId };
type ReportListOptions = {
  page?: number;
  status?: string | null;
};

const notifyBestEffort = async (
  user: unknown,
  payload: ServicePayload,
  context: string
) => {
  try {
    await notifyUser(user, payload);
  } catch (error: unknown) {
    console.warn(`[Admin Notification][${context}] ${getErrorMessage(error)}`);
  }
};

const asServiceRecord = (value: unknown): ServiceRecord | null => (
  typeof value === 'object' && value !== null
    ? value as unknown as ServiceRecord
    : null
);

const assertCanManageUser = async (
  targetId: EntityId,
  actorId: EntityId,
  actorRole: AdminRole
) => {
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

const applyBanConsequences = async (userId: EntityId) => {
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
  } catch (error: unknown) {
    console.warn(
      '[Socket Ban Cleanup] تعذر إنهاء اتصالات المستخدم:',
      getErrorMessage(error)
    );
  }
};

export const getStats = () => adminRepo.getDashboardStats();

export const listUsers = async ({ page = 1, search = '', banned = '' }) => {
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

export const banUser = async (
  userId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  reason: string | null,
  adminNote: string | null
) => {
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

export const unbanUser = async (
  userId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  adminNote: string | null = null
) => {
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

export const listItems = async ({ page = 1 }) => {
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

export const deleteItem = async (
  itemId: EntityId,
  adminId: EntityId,
  adminNote: string | null
) => {
  const item = await Item.findById(itemId).populate('donor', 'name email');
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const donor = asServiceRecord(item.donor);
  const donorName  = typeof donor?.name === 'string' ? donor.name : null;
  const donorEmail = typeof donor?.email === 'string' ? donor.email : null;
  const itemTitle  = item.title        ?? 'غرض محذوف';

  await Item.deleteOne({ _id: itemId });

  if (item.cloudinaryId) {
    try {
      await deleteFromCloudinary(item.cloudinaryId);
    } catch (error: unknown) {
      console.warn(
        '[Admin Items] تعذر حذف صورة الغرض من Cloudinary:',
        getErrorMessage(error)
      );
    }
  }

  const affectedUserIds = [
    donor?._id ?? item.donor,
    item.bookedBy,
    ...(item.waitlist ?? []).map((entry: WaitlistEntry) => entry.user),
  ].filter((id): id is EntityId => typeof id === 'string' || id instanceof Object);
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

export const listReports = async ({ page = 1, status = null }: ReportListOptions = {}) => {
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

export const resolveReport = async (
  reportId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  status: string,
  adminNote: string | null = null
) => {
  const allowedStatuses: readonly ReportResolutionStatus[] = [
    'actioned',
    'reviewed',
    'dismissed',
  ];
  if (!allowedStatuses.includes(status as ReportResolutionStatus))
    throw new AppError('حالة غير صالحة للبلاغ', 400, 'INVALID_REPORT_STATUS');
  const resolutionStatus = status as ReportResolutionStatus;

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
    resolutionStatus,
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
  const reporter = asServiceRecord(fullReport?.reporter);
  const reportedUser = asServiceRecord(fullReport?.reportedUser);
  const relatedItem = asServiceRecord(fullReport?.relatedItem);

  const statusLabel = {
    actioned:  'تم الإجراء',
    reviewed:  'تمّت المراجعة',
    dismissed: 'تم الرفض',
  }[resolutionStatus];

  await adminRepo.logAdminAction({
    adminId,
    action:      'REPORT_ACTION',
    targetId:    reportId,
    targetModel: 'Report',
    reason:      statusLabel,
    adminNote:   adminNote ?? null,
    meta: {
      targetName:       reportedUser?.name  ?? '—',
      reportedBy:       reporter?.name      ?? '—',
      reason:           fullReport?.reason              ?? '—',
      action:           statusLabel,
      relatedItemTitle: relatedItem?.title  ?? null,
    },
  });

  const reporterMessage = {
    actioned:  'تمت مراجعة بلاغك واتخاذ إجراء مناسب.',
    reviewed:  'تمت مراجعة بلاغك وإغلاقه بعد التحقق.',
    dismissed: 'تمت مراجعة بلاغك ولم يتم اعتماد إجراء عليه.',
  }[resolutionStatus];

  if (reporter?._id) {
    await notifyBestEffort(reporter, {
      type:      'report_resolved',
      title:     'تمت معالجة بلاغك',
      body:      reporterMessage,
      itemId:    relatedItem?._id ?? null,
      actionUrl: '/dashboard',
      metadata:  { reportId: String(reportId), status: resolutionStatus },
    }, 'report-resolution');
  }

  if (resolutionStatus === 'actioned' && report.reportedUser) {
    await notifyBestEffort(reportedUser ?? report.reportedUser, {
      type:   'admin_warning',
      title:  'تحذير من الإدارة',
      body:   '⚠️ اتخذت الإدارة إجراءً بسبب بلاغ مقدم ضدك.',
      itemId: relatedItem?._id ?? null,
      actionUrl: '/dashboard',
      metadata: { reportId: String(reportId), status: resolutionStatus },
    }, 'report-warning');

    const settings = await SystemSettings.getCached();
    const threshold = settings.autoReportBanThreshold ?? 5;
    const actionedCount = await reportRepository.countActionedByReportedUser(
      report.reportedUser
    );
    const target = reportedUser;

    if (
      actionedCount >= threshold
      && target
      && !target.isBanned
      && target.role === 'user'
    ) {
      await banUser(
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

export { applyBanConsequences };

export const listAuditLogs = async ({ page = 1 }) => {
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

export const promoteToLevel2 = async (
  targetId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  reason: string | null = null,
  adminNote: string | null = null
) => {
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

export const demoteToLevel1 = async (
  targetId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  reason: string | null = null,
  adminNote: string | null = null
) => {
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

export default { getStats, listUsers, banUser, unbanUser, listItems, deleteItem, listReports, resolveReport, applyBanConsequences, listAuditLogs, promoteToLevel2, demoteToLevel1 };
