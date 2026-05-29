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
    'item_booked',
    'booking_cancelled',
    'waitlist_promoted',
    'delivery_done',         // ✅ القديم (إبقه للتوافق)
    'delivery_completed',    // ✅ جديد — إتمام التسليم
    'recipient_confirmed',   // ✅ جديد — المستلم أكّد الاستلام
    'new_rating',
    'report_resolved',
    'admin_warning',
    'admin_ban',
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