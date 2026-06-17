// models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporter:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    relatedItem:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },

    reason:  { type: String, required: true, maxlength: 300 },
    details: { type: String, maxlength: 1000 },

    status: {
      type:    String,
      enum:    ['pending', 'reviewed', 'dismissed', 'actioned'],
      default: 'pending',
    },

    // ✅ FIX BUG-04: adminNote يُحفَظ الآن بشكل صحيح من resolveReport
    adminNote:  { type: String, maxlength: 1000 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    appealText:     { type: String, maxlength: 1000 },
    appealedAt:     { type: Date },
    appealDeadline: { type: Date },
    resolvedAt:     { type: Date },
  },
  { timestamps: true }
);

// ✅ FIX BUG-05: Compound index لتسريع الـ Aggregation على status + createdAt
reportSchema.index({ status: 1, createdAt: -1 });

// منع تكرار البلاغ المفتوح نفسه (يسمح بإعادة البلاغ بعد إغلاق السابق)
reportSchema.index(
  { reporter: 1, reportedUser: 1, relatedItem: 1, status: 1 },
  { unique: true }
);

module.exports = mongoose.model('Report', reportSchema);