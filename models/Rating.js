const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  item:       { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  rater:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // المستلم
  ratee:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // المتبرع
  rating:     { type: Number, min: 1, max: 5, required: true },
  comment:    { type: String, maxlength: 300 },
  trustDelta: { type: Number }, // النقاط المُضافة/المخصومة
}, { timestamps: true });

// تقييم واحد لكل غرض
ratingSchema.index({ item: 1 }, { unique: true });
// ✅ يُنفَّذ بعد handover ناجح فقط — التحقق في itemService

module.exports = mongoose.model('Rating', ratingSchema);