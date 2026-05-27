// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  type: {
    type: String,
    enum: [
      'item_booked',       // حد حجز غرضك
      'booking_cancelled', // حد ألغى حجزه
      'waitlist_promoted', // وصل دورك من الـ Waitlist
      'delivery_done',     // تم التسليم
      'new_rating',        // حصلت على تقييم
      'report_resolved',   // تم البت في بلاغك
    ],
    required: true,
  },
  title:   { type: String, required: true },
  body:    { type: String, required: true },
  itemId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  isRead:  { type: Boolean, default: false, index: true },
}, { timestamps: true });

// index مركّب للجلب السريع
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);