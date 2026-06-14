// repositories/reportRepository.js — النسخة المُصلَحة الكاملة
const Report = require('../models/Report');

// ── قراءة ─────────────────────────────────────────────────────
exports.createReport = (payload) => Report.create(payload);

exports.findById = (reportId) => Report.findById(reportId);

// ✅ جديد: جلب بلاغ مع populate كامل (يُستخدم في resolveReport)
exports.findByIdPopulated = (reportId) =>
  Report.findById(reportId)
    .populate('reportedUser', 'name email isBanned')
    .populate('reporter',     'name email')
    .populate('relatedItem',  'title');

// ✅ جديد: التحقق من وجود بلاغ مسبق (ليُستخدم كـ guard)
exports.findExistingPending = (reporterId, reportedUserId, itemId) =>
  Report.findOne({
    reporter:     reporterId,
    reportedUser: reportedUserId,
    relatedItem:  itemId ?? null,
    status:       'pending',
  });

// ✅ جديد: عدد البلاغات ضد مستخدم معين
exports.countByReportedUser = (userId) =>
  Report.countDocuments({ reportedUser: userId });

// ── تحديث ─────────────────────────────────────────────────────
exports.save = (report) => report.save();

// ✅ جديد: تحديث حالة البلاغ مع resolvedBy
exports.resolve = (reportId, adminId, status) =>
  Report.findByIdAndUpdate(
    reportId,
    { $set: { status, resolvedBy: adminId, resolvedAt: new Date() } },
    { new: true }
  );