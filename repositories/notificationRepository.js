// repositories/notificationRepository.js
const Notification = require('../models/Notification');

exports.findLatestByUser = (userId, limit = 20) =>
  Notification.find({ user: userId })
    .select('_id type title body itemId conversationId actionUrl metadata isRead createdAt')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

exports.countByUser = (userId) =>
  Notification.countDocuments({ user: userId });

exports.countUnreadByUser = (userId) =>
  Notification.countDocuments({
    user: userId,
    isRead: false,
  });

exports.markAllReadByUser = (userId) =>
  Notification.updateMany(
    { user: userId, isRead: false },
    { $set: { isRead: true } }
  );

exports.markOneReadByUser = (notificationId, userId) =>
  Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { $set: { isRead: true } },
    { returnDocument: 'after' }
  ).lean();
