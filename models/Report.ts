import mongoose from 'mongoose';

export const REPORT_STATUSES = Object.freeze([
  'pending',
  'reviewed',
  'dismissed',
  'actioned',
]);

const reportSchema = new mongoose.Schema(
  {
    reporter:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    relatedItem:  { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },

    reason:  { type: String, required: true, trim: true, maxlength: 100 },
    details: { type: String, trim: true, maxlength: 1000, default: '' },

    status: {
      type:    String,
      enum:    REPORT_STATUSES,
      default: 'pending',
    },

    // ✅ FIX BUG-04: adminNote يُحفَظ الآن بشكل صحيح من resolveReport
    adminNote:  { type: String, trim: true, maxlength: 1000 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    appealText:     { type: String, trim: true, maxlength: 1000 },
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
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'pending_report_context_unique',
  }
);

type ReportDocument = mongoose.InferSchemaType<typeof reportSchema>;
type ReportModel = mongoose.Model<ReportDocument> & {
  REPORT_STATUSES: typeof REPORT_STATUSES;
};

const Report = mongoose.model('Report', reportSchema) as ReportModel;
Report.REPORT_STATUSES = REPORT_STATUSES;

export default Report;
