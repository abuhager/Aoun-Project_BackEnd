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
import runMongoTransaction from '../utils/mongoTransaction.js';
import type { EntityId, ServicePayload, ServiceRecord } from './serviceTypes.js';
import { getErrorMessage } from './serviceTypes.js';
import type { ClientSession } from 'mongoose';

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
  actorRole: AdminRole,
  session: ClientSession | null = null
) => {
  const target = await userRepository.findByIdForAdmin(targetId, session);
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

const applyBanConsequences = async (
  userId: EntityId,
  session: ClientSession | null = null
) => {
  await Item.updateMany(
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
    },
    { session: session ?? undefined }
  );
  await Item.updateMany(
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
    },
    { session: session ?? undefined }
  );
  await Item.updateMany(
    { 'waitlist.user': userId },
    { $pull: { waitlist: { user: userId } } },
    { session: session ?? undefined }
  );
};

const disconnectBannedUserBestEffort = async (userId: EntityId) => {
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
  const user = await runMongoTransaction(async (session) => {
    const target = await assertCanManageUser(userId, adminId, adminRole, session);
    const updated = await adminRepo.banUser(userId, reason, adminId, session);
    if (!updated) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

    await userRepository.invalidateUserSession(userId, session);
    await applyBanConsequences(userId, session);
    await adminRepo.logAdminAction({
      adminId, action: 'BAN', targetId: userId, targetModel: 'User',
      targetName: target.name, reason: reason ?? 'حظر يدوي', adminNote: adminNote ?? null,
      meta: { targetName: target.name, targetEmail: target.email ?? null },
    }, session);

    return updated;
  });

  await notifyBestEffort(user, {
    type:  'admin_ban',
    title: 'تم حظر حسابك',
    body:  reason
      ? `حظرت الإدارة حسابك. السبب: ${reason}`
      : 'حظرت الإدارة حسابك بسبب مخالفة سياسات المنصة.',
  }, 'ban');

  sessionCache.invalidate(userId);
  await disconnectBannedUserBestEffort(userId);

  return user;
};

export const unbanUser = async (
  userId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  adminNote: string | null = null
) => {
  const user = await runMongoTransaction(async (session) => {
    const target = await assertCanManageUser(userId, adminId, adminRole, session);
    const updated = await adminRepo.unbanUser(userId, session);
    if (!updated) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

    await adminRepo.logAdminAction({
      adminId, action: 'UNBAN', targetId: userId, targetModel: 'User',
      targetName: target.name, reason: 'رفع الحظر يدوياً من الأدمن', adminNote: adminNote ?? null,
      meta: { targetName: target.name, targetEmail: target.email ?? null },
    }, session);
    return updated;
  });

  sessionCache.invalidate(userId);
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
  const item = await runMongoTransaction(async (session) => {
    const existing = await Item.findById(itemId)
      .populate('donor', 'name email')
      .session(session);
    if (!existing) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

    const donor = asServiceRecord(existing.donor);
    const donorName  = typeof donor?.name === 'string' ? donor.name : null;
    const donorEmail = typeof donor?.email === 'string' ? donor.email : null;
    const itemTitle  = existing.title ?? 'غرض محذوف';

    await Item.deleteOne({ _id: itemId }, { session });
    await adminRepo.logAdminAction({
      adminId, action: 'ITEM_HIDE', targetId: itemId, targetModel: 'Item',
      targetName: donorName ?? itemTitle, reason: 'حذف غرض من لوحة الإدارة',
      adminNote: adminNote ?? null,
      meta: { targetName: donorName ?? itemTitle, targetEmail: donorEmail, itemTitle },
    }, session);

    return existing;
  });

  const donor = asServiceRecord(item.donor);
  const itemTitle  = item.title        ?? 'غرض محذوف';

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

  const settings = await SystemSettings.getCached();
  const threshold = settings.autoReportBanThreshold ?? 5;
  const statusLabel = {
    actioned:  'تم الإجراء',
    reviewed:  'تمّت المراجعة',
    dismissed: 'تم الرفض',
  }[resolutionStatus];

  const transactionResult = await runMongoTransaction(async (session) => {
    const existingReport = await reportRepository.findByIdPopulated(reportId, session);
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
      adminNote,
      session
    );
    if (!report) {
      throw new AppError(
        'سبق لمشرف آخر البت في هذا البلاغ',
        409,
        'REPORT_RESOLUTION_CONFLICT'
      );
    }

    const fullReport = await reportRepository.findByIdPopulated(reportId, session);
    const reporter = asServiceRecord(fullReport?.reporter);
    const reportedUser = asServiceRecord(fullReport?.reportedUser);
    const relatedItem = asServiceRecord(fullReport?.relatedItem);

    await adminRepo.logAdminAction({
      adminId,
      action:      'REPORT_ACTION',
      targetId:    reportId,
      targetModel: 'Report',
      reason:      statusLabel,
      adminNote:   adminNote ?? null,
      meta: {
        targetName:       reportedUser?.name ?? '—',
        reportedBy:       reporter?.name ?? '—',
        reason:           fullReport?.reason ?? '—',
        action:           statusLabel,
        relatedItemTitle: relatedItem?.title ?? null,
      },
    }, session);

    let actionedCount = 0;
    let autoBannedUser = null;
    let autoBanReason: string | null = null;
    if (resolutionStatus === 'actioned' && report.reportedUser) {
      actionedCount = await reportRepository.countActionedByReportedUser(
        report.reportedUser,
        session
      );
      if (
        actionedCount >= threshold
        && reportedUser
        && !reportedUser.isBanned
        && reportedUser.role === 'user'
      ) {
        autoBanReason = `حظر تلقائي بعد اعتماد ${actionedCount} بلاغات`;
        autoBannedUser = await adminRepo.banUser(
          report.reportedUser,
          autoBanReason,
          adminId,
          session
        );
        if (!autoBannedUser) {
          throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
        }
        await userRepository.invalidateUserSession(report.reportedUser, session);
        await applyBanConsequences(report.reportedUser, session);
        await adminRepo.logAdminAction({
          adminId,
          action: 'BAN',
          targetId: report.reportedUser,
          targetModel: 'User',
          targetName: typeof reportedUser.name === 'string' ? reportedUser.name : null,
          reason: autoBanReason,
          adminNote: `عتبة الحظر التلقائي المضبوطة: ${threshold}`,
          meta: {
            targetName: reportedUser.name ?? null,
            targetEmail: reportedUser.email ?? null,
            reportId: String(reportId),
            actionedCount,
            threshold,
          },
        }, session);
      }
    }

    return {
      report,
      fullReport,
      reporter,
      reportedUser,
      relatedItem,
      autoBannedUser,
      autoBanReason,
    };
  });

  const {
    report,
    fullReport,
    reporter,
    reportedUser,
    relatedItem,
    autoBannedUser,
    autoBanReason,
  } = transactionResult;

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

    if (autoBannedUser) {
      await notifyBestEffort(autoBannedUser, {
        type: 'admin_ban',
        title: 'تم حظر حسابك',
        body: autoBanReason
          ? `حظرت الإدارة حسابك. السبب: ${autoBanReason}`
          : 'حظرت الإدارة حسابك بسبب مخالفة سياسات المنصة.',
      }, 'automatic-ban');
      sessionCache.invalidate(report.reportedUser);
      await disconnectBannedUserBestEffort(report.reportedUser);
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
  const settings    = await SystemSettings.getCached();
  const level2Quota = settings?.level2Quota ?? 4;
  const updated = await runMongoTransaction(async (session) => {
    const user = await assertCanManageUser(targetId, adminId, adminRole, session);
    if (user.isBanned) throw new AppError('لا يمكن ترقية مستخدم محظور', 403, 'USER_BANNED');
    if (user.trustLevel !== 1) throw new AppError(
      `لا يمكن الترقية اليدوية — مستوى المستخدم الحالي هو ${user.trustLevel}`,
      400, 'MANUAL_PROMOTE_RESTRICTED'
    );

    const promoted = await userRepository.setTrustLevelAndQuota(
      targetId,
      2,
      level2Quota,
      session
    );
    await adminRepo.logAdminAction({
      adminId, action: 'PROMOTE', targetId, targetModel: 'User',
      targetName: user.name, reason: reason ?? 'ترقية يدوية', adminNote: adminNote ?? null,
      meta: { targetName: user.name, targetEmail: user.email ?? null, fromLevel: user.trustLevel, toLevel: 2 },
    }, session);
    return promoted;
  });

  sessionCache.invalidate(targetId);
  return updated;
};

export const demoteToLevel1 = async (
  targetId: EntityId,
  adminId: EntityId,
  adminRole: AdminRole,
  reason: string | null = null,
  adminNote: string | null = null
) => {
  const settings     = await SystemSettings.getCached();
  const defaultQuota = settings?.defaultUserQuota ?? 2;
  const updated = await runMongoTransaction(async (session) => {
    const user = await assertCanManageUser(targetId, adminId, adminRole, session);
    if (user.trustLevel === 1) throw new AppError('المستخدم في المستوى 1 بالفعل', 400, 'ALREADY_LEVEL1');

    const demoted = await userRepository.setTrustLevelAndQuota(
      targetId,
      1,
      defaultQuota,
      session
    );
    await adminRepo.logAdminAction({
      adminId, action: 'DEMOTE', targetId, targetModel: 'User',
      targetName: user.name, reason: reason ?? 'تخفيض يدوي', adminNote: adminNote ?? null,
      meta: { targetName: user.name, targetEmail: user.email ?? null, fromLevel: user.trustLevel, toLevel: 1 },
    }, session);
    return demoted;
  });

  sessionCache.invalidate(targetId);
  return updated;
};

export default { getStats, listUsers, banUser, unbanUser, listItems, deleteItem, listReports, resolveReport, applyBanConsequences, listAuditLogs, promoteToLevel2, demoteToLevel1 };
