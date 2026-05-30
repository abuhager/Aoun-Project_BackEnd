// repositories/notificationRepository.js
const Notification = require('../models/Notification');

exports.findLatestByUser = (userId, limit = 20) =>
  Notification.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

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
    { new: true }
  );