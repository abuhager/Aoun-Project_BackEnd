const User     = require('../models/User');
const Item     = require('../models/Item');
const Report   = require('../models/Report');
const AdminLog = require('../models/AdminLog');

// ── المستخدمون ────────────────────────────────────────────────
exports.findAllUsers = ({ page = 1, limit = 20, search } = {}) => {
  const filter = search
    ? {
        $or: [
          { name:  new RegExp(search, 'i') },
          { email: new RegExp(search, 'i') },
        ],
      }
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
    ? {
        $or: [
          { name:  new RegExp(search, 'i') },
          { email: new RegExp(search, 'i') },
        ],
      }
    : {};

  return User.countDocuments(filter);
};

exports.banUser = (userId, reason, bannedBy) =>
  User.findByIdAndUpdate(
    userId,
    { $set: { isBanned: true, banReason: reason, bannedBy } },
    { returnDocument: 'after' }
  );

exports.unbanUser = (userId) =>
  User.findByIdAndUpdate(
    userId,
    { $set: { isBanned: false }, $unset: { banReason: '', bannedBy: '' } },
    { returnDocument: 'after' }
  );

exports.adjustTrustScore = (userId, delta) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: delta } },
    { returnDocument: 'after' }
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
const pendingFilter = {
  status: 'pending',
  $or: [
    { appealDeadline: { $lte: new Date() } },
    { appealText: { $exists: true, $ne: null } },
    { appealDeadline: { $exists: false } },
  ],
};

exports.findPendingReports = ({ page = 1, limit = 20 } = {}) =>
  Report.find(pendingFilter)
    .populate('reporter',     'name email')
    .populate('reportedUser', 'name email')
    .populate('relatedItem',  'title')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

exports.countPendingReports = () => Report.countDocuments(pendingFilter);

exports.resolveReport = (reportId, adminId, status) =>
  Report.findByIdAndUpdate(
    reportId,
    { $set: { status, resolvedBy: adminId, resolvedAt: new Date() } },
    { returnDocument: 'after' }
  );

// ── السجلات ───────────────────────────────────────────────────
exports.logAdminAction = ({
  adminId,
  action,
  targetId,
  targetModel,
  reason,
  meta,
  targetName,
  adminNote,
}) =>
  AdminLog.create({
    adminId,
    action,
    targetId,
    targetModel,
    reason,
    meta,
    targetName,
    adminNote,
  });

exports.findAdminLogs = ({ page = 1, limit = 20 } = {}) =>
  AdminLog.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('adminId',  'name email')
    .populate('targetId', 'name email title')
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