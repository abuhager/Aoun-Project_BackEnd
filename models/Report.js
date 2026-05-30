const mongoose = require('mongoose');



const reportSchema = new mongoose.Schema({
  reporter:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relatedItem:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  reason: { type: String, required: true, maxlength: 100 },
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
  appealDeadline: { type: Date },
  resolvedAt:   { type: Date },
}, { timestamps: true });

// منع التبليغ المزدوج
// ✅ منع البلاغ المكرر على نفس الغرض
reportSchema.index({ reporter: 1, reportedUser: 1, relatedItem: 1 , status: 1 }, { unique: true });
module.exports = mongoose.model('Report', reportSchema);