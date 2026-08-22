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
      'booking_transferred',
      'booking_expiry_reminder',
      'waitlist_promoted',
      'delivery_done',
      'delivery_completed',
      'recipient_confirmed',
      'matching_item',
      'item_deleted',
      'item_deleted_by_admin',
      'new_rating',
      'report_resolved',
      'admin_warning',
      'admin_ban',
      'account_suspended',
      'new_message',
      'request_new_offer',
      'request_cancelled_by_requester',
      'request_expired',
      'offer_accepted',
      'offer_rejected',
      'offer_withdrawn',
    ],
    required: true,
  },
  title:   { type: String, required: true },
  body:    { type: String, required: true },
  itemId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },
  actionUrl: { type: String, default: null, maxlength: 500 },
  metadata:  { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  isRead:  { type: Boolean, default: false, index: true },
}, { timestamps: true });

// index مركّب للجلب السريع
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
