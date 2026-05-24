// models/Item.js
// ✅ Phase 1 Fix:
//    Bug #14 — إضافة Compound Indexes للاستعلامات الشائعة

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
      type:     String,
      required: [true, 'العنوان مطلوب'],
      trim:     true,
      maxlength: [100, 'العنوان طويل جداً'],
    },
    description: {
      type:     String,
      trim:     true,
      maxlength: [1000, 'الوصف طويل جداً'],
    },
    category: {
      type: String,
      enum: ['ملابس', 'أثاث', 'إلكترونيات', 'كتب', 'أدوات', 'أخرى'],
      default: 'أخرى',
    },
    location:    { type: String, trim: true },
    imageUrl:    { type: String },
    cloudinaryId:{ type: String },

    donor: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    bookedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      default: null,
    },
    bookedAt: { type: Date, default: null },

    status: {
      type:    String,
      enum:    ['متاح', 'محجوز', 'تم التسليم', 'مخفي'],
      default: 'متاح',
      index:   true, // ✅ index بسيط — الحقل الأكثر تصفية
    },

    // ✅ Fix Bug #21 — deliveryOtp لا يُجلب في الاستعلامات العامة
    // نستخدم select: false حتى لا يظهر إلا عند الطلب الصريح
    deliveryOtp: {
      type:   String,
      select: false, // ✅ مخفي افتراضياً في كل populate/find
    },

    waitlist:    [WaitlistEntrySchema],
    cancelledBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    isRated: { type: Boolean, default: false },
    rating:  { type: Number, min: 1, max: 5, default: null },
  },
  {
    timestamps: true,
    // ✅ في production: autoIndex: false — نُنشئ الـ indexes يدوياً
    autoIndex: process.env.NODE_ENV !== 'production',
  }
);

// ─── Compound Indexes ─────────────────────────────────────────
// ✅ Fix Bug #14 — الفهارس المركبة للاستعلامات الشائعة

// 1. الصفحة الرئيسية: فلترة بالـ status مع ترتيب زمني
//    Query: Item.find({ status: 'متاح' }).sort({ createdAt: -1 })
ItemSchema.index({ status: 1, createdAt: -1 });

// 2. فلترة بالفئة والحالة
//    Query: Item.find({ category: 'ملابس', status: 'متاح' })
ItemSchema.index({ category: 1, status: 1 });

// 3. لوحة تحكم المتبرع: أغراضي مع ترتيب
//    Query: Item.find({ donor: userId }).sort({ createdAt: -1 })
ItemSchema.index({ donor: 1, createdAt: -1 });

// 4. حجوزات المستخدم
//    Query: Item.find({ bookedBy: userId }).sort({ createdAt: -1 })
ItemSchema.index({ bookedBy: 1, createdAt: -1 });

// 5. Cron Job: إيجاد الحجوزات المنتهية (Phase 5 - cronJobs fix)
//    Query: Item.find({ status: 'محجوز', bookedAt: { $lt: cutoff } })
ItemSchema.index({ status: 1, bookedAt: 1 });

// 6. البحث النصي بالعنوان
//    Query: Item.find({ title: /regex/ })
ItemSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Item', ItemSchema);