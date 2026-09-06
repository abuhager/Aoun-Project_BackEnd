import Notification from '../models/Notification.js';
import type { EntityId } from './repositoryTypes.js';

export const findLatestByUser = (userId: EntityId, limit = 20) =>
  Notification.find({ user: userId })
    .select('_id type title body itemId conversationId actionUrl metadata isRead createdAt')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

export const countByUser = (userId: EntityId) =>
  Notification.countDocuments({ user: userId });

export const countUnreadByUser = (userId: EntityId) =>
  Notification.countDocuments({
    user: userId,
    isRead: false,
  });

export const markAllReadByUser = (userId: EntityId) =>
  Notification.updateMany(
    { user: userId, isRead: false },
    { $set: { isRead: true } }
  );

export const markOneReadByUser = (notificationId: EntityId, userId: EntityId) =>
  Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { $set: { isRead: true } },
    { returnDocument: 'after' }
  ).lean();

export default { findLatestByUser, countByUser, countUnreadByUser, markAllReadByUser, markOneReadByUser };
