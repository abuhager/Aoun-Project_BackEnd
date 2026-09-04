// services/notificationService.js
const notificationRepository = require('../repositories/notificationRepository');
const AppError = require('../utils/AppError');
const { toNotificationDto } = require('../dtos/notificationDto');
import type { EntityId } from './serviceTypes';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const normalizeLimit = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
};

exports.getNotificationsLogic = async (
  userId: EntityId,
  { limit }: { limit?: string | number } = {}
) => {
  const safeLimit = normalizeLimit(limit);
  const [notifications, unreadCount, totalCount] = await Promise.all([
    notificationRepository.findLatestByUser(userId, safeLimit),
    notificationRepository.countUnreadByUser(userId),
    notificationRepository.countByUser(userId),
  ]);

  return {
    notifications: notifications.map(toNotificationDto),
    unreadCount,
    totalCount,
    hasMore: totalCount > notifications.length,
    limit: safeLimit,
  };
};

exports.markAllReadLogic = async (userId: EntityId) => {
  const result = await notificationRepository.markAllReadByUser(userId);

  return {
    msg: 'تم تعليم الكل مقروءاً ✅',
    updatedCount: result.modifiedCount ?? 0,
  };
};

exports.markOneReadLogic = async (notificationId: EntityId, userId: EntityId) => {
  const notification = await notificationRepository.markOneReadByUser(
    notificationId,
    userId
  );

  if (!notification) {
    throw new AppError('الإشعار غير موجود', 404, 'NOTIFICATION_NOT_FOUND');
  }

  return {
    msg: 'تم ✅',
    notification: toNotificationDto(notification),
  };
};

exports.normalizeLimit = normalizeLimit;
