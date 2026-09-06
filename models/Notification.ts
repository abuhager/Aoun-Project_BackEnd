import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = Object.freeze([
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
]);

export const isInternalActionPath = (value: unknown): boolean => value == null || (
  typeof value === 'string'
  && value.startsWith('/')
  && !value.startsWith('//')
  && !value.includes('\\')
  && !/[\r\n]/.test(value)
);

const notificationSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 160,
  },
  body: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 1000,
  },
  itemId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },
  actionUrl: {
    type: String,
    default: null,
    trim: true,
    maxlength: 500,
    validate: {
      validator: isInternalActionPath,
      message: 'رابط الإشعار يجب أن يكون مساراً داخلياً',
    },
  },
  metadata:  { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  isRead:  { type: Boolean, default: false, index: true },
}, { timestamps: true });

// index مركّب للجلب السريع
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

type NotificationDocument = mongoose.InferSchemaType<typeof notificationSchema>;
type NotificationModel = mongoose.Model<NotificationDocument> & {
  NOTIFICATION_TYPES: typeof NOTIFICATION_TYPES;
  isInternalActionPath: typeof isInternalActionPath;
};

const Notification = mongoose.model('Notification', notificationSchema) as NotificationModel;

Notification.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
Notification.isInternalActionPath = isInternalActionPath;

export default Notification;
