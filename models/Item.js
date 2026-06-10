const mongoose = require('mongoose');

const WaitlistEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ItemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'العنوان مطلوب'],
      trim: true,
      maxlength: [100, 'العنوان طويل جداً'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'الوصف طويل جداً'],
    },
    category: {
      type: String,
      default: 'أخرى',
      trim: true,
    },
    location: { type: String, trim: true },
    imageUrl: { type: String },
    cloudinaryId: { type: String },
    condition: {
      type: String,
      enum: ['جديد', 'مستعمل ممتاز', 'مستعمل جيد'],
      required: true,
    },
    safeHub: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SafeHub',
      required: true,
    },
    reportCount: {
      type: Number,
      default: 0,
      index: true,
    },
    donor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bookedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    bookedAt: {
      type: Date,
      default: null,
      index: true,
    },
    // ✅ [A] حُذف حقل deliveryOtp بالكامل — النظام يعتمد على Double Confirmation
    status: {
      type: String,
      enum: ['متاح', 'محجوز', 'تم التسليم', 'مخفي'],
      default: 'متاح',
      index: true,
    },
    recipientConfirmed: {
      type: Boolean,
      default: false,
      index: true,
    },
    recipientConfirmedAt: {
      type: Date,
      default: null,
    },
    donorConfirmedAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
      index: true,
    },
    waitlist: [WaitlistEntrySchema],
    cancelledBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isRated: {
      type: Boolean,
      default: false,
    },
    linkedRequestId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'DonationRequest',
  default: null,
  index: true,
},

  },
  {
    timestamps: true,
    autoIndex: process.env.NODE_ENV !== 'production',
  }
);

ItemSchema.index({ status: 1, createdAt: -1 });
ItemSchema.index({ category: 1, status: 1, createdAt: -1 });
ItemSchema.index({ donor: 1, createdAt: -1 });
ItemSchema.index({ bookedBy: 1, createdAt: -1 });
ItemSchema.index({ safeHub: 1, status: 1 });
ItemSchema.index({ status: 1, bookedAt: 1 });
ItemSchema.index({ status: 1, deliveredAt: -1 });
ItemSchema.index({ location: 1, status: 1 });
ItemSchema.index({ 'waitlist.user': 1, status: 1 });
ItemSchema.index({ linkedRequestId: 1 });

module.exports = mongoose.model('Item', ItemSchema);