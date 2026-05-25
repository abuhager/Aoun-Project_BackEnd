const mongoose = require('mongoose');

const WaitlistEntrySchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ItemSchema = new mongoose.Schema(
  {
    title: {
      type:      String,
      required:  [true, 'العنوان مطلوب'],
      trim:      true,
      maxlength: [100, 'العنوان طويل جداً'],
    },
    description: {
      type:      String,
      trim:      true,
      maxlength: [1000, 'الوصف طويل جداً'],
    },
    category: {
      type:    String,
      enum:    ['ملابس', 'أثاث', 'إلكترونيات', 'كتب', 'أدوات', 'أخرى'],
      default: 'أخرى',
    },
    location:     { type: String, trim: true },
    imageUrl:     { type: String },
    cloudinaryId: { type: String },
    condition: {
      type:    String,
      enum:    ['ممتازة', 'جيدة', 'مقبولة'],
      default: 'جيدة',
    },
   safeHub: {
  type:     mongoose.Schema.Types.ObjectId,
  ref:      'SafeHub',
  required: true, // ✅
},
    reportCount: {
      type:    Number,
      default: 0,
    },
    donor: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    bookedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
    bookedAt: { type: Date, default: null },
    status: {
      type:    String,
      enum:    ['متاح', 'محجوز', 'تم التسليم', 'مخفي'],
      default: 'متاح',
      index:   true,
    },
    deliveryOtp: {
      type:   String,
      select: false,
    },
    waitlist:    [WaitlistEntrySchema],
    cancelledBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isRated: { type: Boolean, default: false },
    rating:  { type: Number, min: 1, max: 5, default: null },
  },
  {
    timestamps: true,
    autoIndex:  process.env.NODE_ENV !== 'production',
  }
);

// ─── Compound Indexes ──────────────────────────────────────────
ItemSchema.index({ status: 1, createdAt: -1 });
ItemSchema.index({ category: 1, status: 1 });
ItemSchema.index({ donor: 1, createdAt: -1 });
ItemSchema.index({ bookedBy: 1, createdAt: -1 });
ItemSchema.index({ status: 1, bookedAt: 1 });
ItemSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Item', ItemSchema);