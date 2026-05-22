const mongoose = require('mongoose');

const donationRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:     { type: String, required: true, trim: true, maxlength: 100 },
  category:  { type: String, enum: ['كتب', 'إلكترونيات', 'أثاث', 'أخرى', 'ملابس'], required: true },
  description:{ type: String, maxlength: 500 },
  location:  { type: String, required: true },
  status: {
    type:    String,
    enum:    ['active', 'fulfilled', 'expired', 'cancelled'],
    default: 'active',
  },
  // ✅ Phase 5: max 1 طلب نشط في الشهر — يُفرَض في الـ service
  month: { type: String }, // "2025-07" — للتحقق السريع من الكوتا الشهرية
  expiresAt: { type: Date }, // بعد 30 يوم تلقائياً
}, { timestamps: true });

donationRequestSchema.index({ requester: 1, month: 1 });

module.exports = mongoose.model('DonationRequest', donationRequestSchema);