// services/notificationService.js
const notificationRepository = require('../repositories/notificationRepository');
const AppError = require('../utils/AppError');

exports.getNotificationsLogic = async (userId) => {
  const [notifications, unreadCount] = await Promise.all([
    notificationRepository.findLatestByUser(userId, 20),
    notificationRepository.countUnreadByUser(userId),
  ]);

  return { notifications, unreadCount };
};

exports.markAllReadLogic = async (userId) => {
  await notificationRepository.markAllReadByUser(userId);

  return {
    msg: 'تم تعليم الكل مقروءاً ✅',
  };
};

exports.markOneReadLogic = async (notificationId, userId) => {
  const notification = await notificationRepository.markOneReadByUser(
    notificationId,
    userId
  );

  if (!notification) {
    throw new AppError('الإشعار غير موجود', 404, 'NOTIFICATION_NOT_FOUND');
  }

  return {
    msg: 'تم ✅',
  };
};