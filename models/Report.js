// models/Report.js — النسخة المُصلَحة الكاملة
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporter:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    relatedItem:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },

    reason:  { type: String, required: true, maxlength: 300 }, // ✅ BUG-07: رُفع من 100 → 300 ليطابق validateBody.createReport
    details: { type: String, maxlength: 1000 },                // ✅ BUG-07: رُفع من 500 → 1000 ليطابق validateBody

    status: {
      type:    String,
      enum:    ['pending', 'reviewed', 'dismissed', 'actioned'],
      default: 'pending',
    },

    adminNote:  { type: String, maxlength: 1000 },

    // ✅ BUG-01: resolvedBy كان مفقوداً من الـ Schema — Mongoose يُهمله بصمت عند الحفظ
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // نافذة الطعن
    appealText:     { type: String, maxlength: 1000 }, // ✅ BUG-07: ليطابق validateBody.submitAppeal
    appealedAt:     { type: Date },
    appealDeadline: { type: Date },  // ✅ BUG-02: يُحفَظ الآن من reportService عند الإنشاء
    resolvedAt:     { type: Date },
  },
  { timestamps: true }
);

// ✅ BUG-09 (توضيح مقصود): الـ unique index يشمل status='pending'
// → يسمح بإعادة البلاغ بعد إغلاق السابق — هذا سلوك مقصود للسماح بالبلاغات المتجددة
reportSchema.index(
  { reporter: 1, reportedUser: 1, relatedItem: 1, status: 1 },
  { unique: true }
);

module.exports = mongoose.model('Report', reportSchema);