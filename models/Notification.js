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
    'delivery_done',
    'delivery_completed',
    'recipient_confirmed',
    'new_rating',
    'report_resolved',
    'admin_warning',
    'admin_ban',
    'new_message',
    'request_new_offer',     // ✅ مضاف
    'offer_accepted',        // ✅ مضاف — للمتبرع عند قبول عرضه
    'offer_rejected',        // ✅ مضاف — للمتبرع عند رفض عرضه
    'matching_item',         // ✅ مضاف — موجود في itemService.js
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