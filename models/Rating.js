// models/Rating.js
// ✅ Phase 4: رفع التقييم لـ 10 نقاط + حماية من التقييم قبل الاستلام
const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  item:     { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  rater:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // المستلم
  ratee:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // المتبرع

  // ✅ 10 نقاط بدل 5
  score:    { type: Number, min: 1, max: 10, required: true },
  comment:  { type: String, maxlength: 300 },

  // ✅ ضمان: لا تقييم إلا بعد handover ناجح
  isHandoverConfirmed: { type: Boolean, default: false },
  trustDelta:          { type: Number, default: 0 },
}, { timestamps: true });

// ✅ تقييم واحد فقط لكل غرض — لا تكرار
ratingSchema.index({ item: 1, rater: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);