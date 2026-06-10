const mongoose = require('mongoose');

const donationRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:     { type: String, required: true, trim: true, maxlength: 100 },
  category:  { type: String, enum: ['كتب', 'إلكترونيات', 'أثاث', 'أخرى', 'ملابس'], required: true },
  // ✅ إصلاح [ARCH-1]
  urgency:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  description:{ type: String, maxlength: 500 },
  location:  { type: String, required: true },
  status: {
    type:    String,
    enum:    ['active', 'fulfilled', 'expired', 'cancelled'],
    default: 'active',
  },
  month: { type: String },
  expiresAt: { type: Date },
}, { timestamps: true });

donationRequestSchema.index({ requester: 1, month: 1 });
// إضافة إندكس للحقل الجديد لتحسين فلترة الطلبات حسب الأهمية
donationRequestSchema.index({ urgency: 1 });

module.exports = mongoose.model('DonationRequest', donationRequestSchema);