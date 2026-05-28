// repositories/adminRepository.js
const User     = require('../models/User');
const Item     = require('../models/Item');
const Report   = require('../models/Report');
const AdminLog = require('../models/AdminLog');

// ── المستخدمون ────────────────────────────────────────────────
exports.findAllUsers = ({ page = 1, limit = 20, search } = {}) => {
  const filter = search
    ? { $or: [
        { name:  new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
      ]}
    : {};
  return User.find(filter)
    .select('-password -refreshToken -verificationOtp -resetPasswordToken')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
};

exports.countUsers = (search) => {
  const filter = search
    ? { $or: [
        { name:  new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
      ]}
    : {};
  return User.countDocuments(filter);
};

exports.banUser = (userId, reason, bannedBy) =>
  User.findByIdAndUpdate(
    userId,
    { $set: { isBanned: true, banReason: reason, bannedBy } },
    { new: true }
  );

exports.unbanUser = (userId) =>
  User.findByIdAndUpdate(
    userId,
    // ✅ كان $unset فقط — isBanned لازم يرجع false صريح
    { $set: { isBanned: false }, $unset: { banReason: '', bannedBy: '' } },
    { new: true }
  );

exports.adjustTrustScore = (userId, delta) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: delta } },
    { new: true }
  );

// ── الأغراض ───────────────────────────────────────────────────
exports.findAllItems = ({ page = 1, limit = 20 } = {}) =>
  Item.find()
    .populate('donor', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

exports.countItems = () => Item.countDocuments();

// ── البلاغات ──────────────────────────────────────────────────
exports.findPendingReports = ({ page = 1, limit = 20 } = {}) =>
  Report.find({ status: 'pending' })
    .populate('reporter',     'name email')
    .populate('reportedUser', 'name email')
    .populate('relatedItem',  'title')        // ✅ أضف
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

exports.resolveReport = (reportId, adminId, status) =>
  Report.findByIdAndUpdate(
    reportId,
    // ✅ كان status: 'resolved' — مش موجود في الـ enum
    // status القادم من adminService هو: 'actioned' أو 'dismissed' أو 'reviewed'
    { $set: { status, resolvedBy: adminId, resolvedAt: new Date() } },
    { new: true }
  );

// ── السجلات ───────────────────────────────────────────────────
exports.logAdminAction = ({ adminId, action, targetId, targetModel, reason }) =>
  // ✅ كان يرسل 'details' — AdminLog model فيه 'reason' مش 'details'
  AdminLog.create({ adminId, action, targetId, targetModel, reason });

exports.findAdminLogs = ({ page = 1, limit = 20 } = {}) =>
  AdminLog.find()
    .populate('adminId', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

// ── الإحصائيات (Dashboard) ────────────────────────────────────
exports.getDashboardStats = () =>
  Promise.all([
    User.countDocuments(),
    User.countDocuments({ isBanned: true }),
    Item.countDocuments(),
    Item.countDocuments({ status: 'تم التسليم' }),
    Report.countDocuments({ status: 'pending' }),
  ]).then(([totalUsers, bannedUsers, totalItems, deliveredItems, pendingReports]) => ({
    totalUsers,
    bannedUsers,
    totalItems,
    deliveredItems,
    pendingReports,
  }));