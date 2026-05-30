// controllers/notificationController.js
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

exports.getNotifications = asyncHandler(async (req, res) => {
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    Notification.countDocuments({
      user: req.user.id,
      isRead: false,
    }),
  ]);

  res.json({ notifications, unreadCount });
});

exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.user.id, isRead: false },
    { $set: { isRead: true } }
  );

  res.json({ msg: 'تم تعليم الكل مقروءاً ✅' });
});

exports.markOneRead = asyncHandler(async (req, res) => {
  const updated = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    { $set: { isRead: true } },
    { new: true }
  ).lean();

  if (!updated) {
    throw new AppError('الإشعار غير موجود', 404, 'NOTIFICATION_NOT_FOUND');
  }

  res.json({ msg: 'تم ✅' });
});