const mongoose = require('mongoose');

const REPORT_REASONS = [
  'لم يُسلّم الغرض',
  'معلومات مضللة',
  'سلوك غير لائق',
  'غرض مختلف عن الوصف',
  'أخرى',
];

const reportSchema = new mongoose.Schema({
  reporter:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relatedItem:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  reason:       { type: String, enum: REPORT_REASONS, required: true },
  details:      { type: String, maxlength: 500 },
  status: {
    type:    String,
    enum:    ['pending', 'reviewed', 'dismissed', 'actioned'],
    default: 'pending', // ✅ لا إجراء تلقائي — ينتظر Admin
  },
  adminNote:    { type: String },
  // ✅ نافذة الطعن للمتبرع (Phase 4)
  appealText:   { type: String },
  appealedAt:   { type: Date },
  resolvedAt:   { type: Date },
}, { timestamps: true });

// منع التبليغ المزدوج
reportSchema.index({ reporter: 1, reportedUser: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);