// controllers/notificationController.js
const Notification = require('../models/Notification');

exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const unreadCount = await Notification.countDocuments({
      user:   req.user.id,
      isRead: false,
    });

    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.id, isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ msg: 'تم تعليم الكل مقروءاً ✅' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

exports.markOneRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: { isRead: true } }
    );
    res.json({ msg: 'تم ✅' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};