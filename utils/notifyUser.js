const Notification = require('../models/Notification');

async function notifyUser(userId, { type, title, body, itemId = null }) {
  const notification = await Notification.create({
    user: userId,
    type,
    title,
    body,
    itemId,
  });

  try {
    const { getIO } = require('../socket');
    getIO().to(`user_${userId}`).emit('notification:new', {
      _id: notification._id,
      type,
      title,
      body,
      itemId,
      isRead: false,
      createdAt: notification.createdAt,
    });
  } catch {
    // DB persistence is enough if socket is unavailable
  }

  return notification;
}

module.exports = { notifyUser };