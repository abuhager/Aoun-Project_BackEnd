// utils/notifyUser.js
const Notification = require('../models/Notification');
const AppError = require('./AppError');

async function notifyUser(userId, payload) {
  if (!userId) {
    throw new AppError('userId مطلوب لإرسال الإشعار', 400, 'USER_ID_REQUIRED');
  }

  const notification = await Notification.create({
    user: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    itemId: payload.itemId ?? null,
    conversationId: payload.conversationId ?? null,
    metadata: payload.metadata ?? null,
  });

  try {
    const { getIO } = require('../socket/socketHandler');

    getIO()
      .to(`user_${userId}`)
      .emit('notification:new', {
        _id: notification._id,
        user: notification.user,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        itemId: notification.itemId ?? null,
        conversationId: notification.conversationId ?? null,
        metadata: notification.metadata ?? null,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
      });
  } catch (err) {
    console.warn('[notifyUser] Socket emission skipped:', err.message);
  }

  return notification;
}

module.exports = notifyUser;