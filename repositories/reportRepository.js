// repositories/reportRepository.js
const Report = require('../models/Report');
const Item   = require('../models/Item');

// ── قراءة ─────────────────────────────────────────────────────
exports.createReport = (payload) => Report.create(payload);

exports.findById = (reportId) => Report.findById(reportId);

exports.findContextItem = (itemId) =>
  Item.findById(itemId)
    .select('donor bookedBy status')
    .lean();

exports.findByIdPopulated = (reportId) =>
  Report.findById(reportId)
    .populate('reportedUser', 'name email isBanned role')
    .populate('reporter',     'name email')
    .populate('relatedItem',  'title');

// ✅ FIX [REPORT-01]: guard صريح ضد التكرار قبل الإنشاء
exports.findExistingPending = (reporterId, reportedUserId, itemId) =>
  Report.findOne({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId ?? null,
    status:       'pending',
  }).select('_id').lean();

exports.countByReportedUser = (userId) =>
  Report.countDocuments({ reportedUser: userId });

exports.countActionedByReportedUser = (userId) =>
  Report.countDocuments({ reportedUser: userId, status: 'actioned' });

// ── تحديث ─────────────────────────────────────────────────────
exports.submitAppeal = ({ reportId, userId, appealText, appealedAt }) =>
  Report.findOneAndUpdate(
    {
      _id:          reportId,
      reportedUser: userId,
      status:       'pending',
      appealText:   null,
      $or: [
        { appealDeadline: { $gte: appealedAt } },
        { appealDeadline: null },
      ],
    },
    { $set: { appealText, appealedAt } },
    { returnDocument: 'after' }
  );
