import notificationRepository from '../repositories/notificationRepository.js';
import AppError from '../utils/AppError.js';
import { toNotificationDto } from '../dtos/notificationDto.js';
import type { EntityId } from './serviceTypes.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const normalizeLimit = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
};

export const getNotificationsLogic = async (
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

export const markAllReadLogic = async (userId: EntityId) => {
  const result = await notificationRepository.markAllReadByUser(userId);

  return {
    msg: 'تم تعليم الكل مقروءاً ✅',
    updatedCount: result.modifiedCount ?? 0,
  };
};

export const markOneReadLogic = async (notificationId: EntityId, userId: EntityId) => {
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

export { normalizeLimit };

export default { getNotificationsLogic, markAllReadLogic, markOneReadLogic, normalizeLimit };
