const mongoose = require('mongoose');

const donationRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:     { type: String, required: true, trim: true, maxlength: 100 },
  
  // ✅ تم إصلاح الخطأ الحرج [ARCH-1]: إزالة enum الثابت ليصبح التصنيف ديناميكيًا بالاعتماد على SystemSettings
  category:  { type: String, required: true, trim: true, maxlength: 50 },
  
  urgency:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  description: { type: String, maxlength: 500 },
  location:  { type: String, required: true },
  status: {
    type:    String,
    enum:    ['active', 'fulfilled', 'expired', 'cancelled'],
    default: 'active',
  },
  month:     { type: String },
  expiresAt: { type: Date },
}, { timestamps: true });

// إضافة الفهارس (Indexes) لتحسين الأداء
donationRequestSchema.index({ requester: 1, month: 1 });
donationRequestSchema.index({ urgency: 1 });

module.exports = mongoose.model('DonationRequest', donationRequestSchema);