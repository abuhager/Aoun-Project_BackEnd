// repositories/reportRepository.js
const Report = require('../models/Report');

// ── قراءة ─────────────────────────────────────────────────────
exports.createReport = (payload) => Report.create(payload);

exports.findById = (reportId) => Report.findById(reportId);

exports.findByIdPopulated = (reportId) =>
  Report.findById(reportId)
    .populate('reportedUser', 'name email isBanned')
    .populate('reporter',     'name email')
    .populate('relatedItem',  'title');

// ✅ FIX [REPORT-01]: guard صريح ضد التكرار قبل الإنشاء
exports.findExistingPending = (reporterId, reportedUserId, itemId) =>
  Report.findOne({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId ?? null,
    status:       'pending',
  });

exports.countByReportedUser = (userId) =>
  Report.countDocuments({ reportedUser: userId });

// ── تحديث ─────────────────────────────────────────────────────
exports.save = (report) => report.save();

exports.resolve = (reportId, adminId, status) =>
  Report.findByIdAndUpdate(
    reportId,
    { $set: { status, resolvedBy: adminId, resolvedAt: new Date() } },
    { new: true }
  );