// utils/notifyUser.js
// Helper مركزي — يحفظ في DB + يبعث Socket في نفس الوقت
const Notification = require('../models/Notification');

async function notifyUser(userId, { type, title, body, itemId = null }) {
  // 1. احفظ في DB
  const notification = await Notification.create({
    user: userId, type, title, body, itemId,
  });

  // 2. ابعث Socket فوراً (لا تكسر الـ flow لو Socket فشل)
  try {
    const { getIo } = require('../socket');
    getIo().to(`user:${userId}`).emit('notification:new', {
      _id:       notification._id,
      type,
      title,
      body,
      itemId,
      isRead:    false,
      createdAt: notification.createdAt,
    });
  } catch {
    // Socket غير جاهز — الإشعار محفوظ في DB على كل حال
  }

  return notification;
}

module.exports = { notifyUser };