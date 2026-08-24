// repositories/adminRepository.js
const User     = require('../models/User');
const Item     = require('../models/Item');
const Report   = require('../models/Report');
const AdminLog = require('../models/AdminLog');

// ── مساعد: تهريب أحرف RegExp لمنع ReDoS ─────────────────────
const getSafeSearchRegex = (search) => {
  if (!search) return null;
  const truncated = String(search).slice(0, 100);
  const escaped   = truncated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
};

// ── helper داخلي لبناء filter المستخدمين ─────────────────────
const buildUserFilter = ({ search, banned = '' } = {}) => {
  const filter = {};
  const searchRegex = getSafeSearchRegex(search);
  if (searchRegex) {
    filter.$or = [{ name: searchRegex }, { email: searchRegex }];
  }
  if (banned === 'true')       filter.isBanned = true;
  else if (banned === 'false') filter.isBanned = false;
  return filter;
};

// ── المستخدمون ────────────────────────────────────────────────
exports.findAllUsers = ({ page = 1, limit = 20, search, banned = '' } = {}) => {
  const filter = buildUserFilter({ search, banned });
  return User.find(filter)
    .select('-password -refreshToken -verificationOtp -resetPasswordToken')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
};

exports.countUsers = ({ search, banned = '' } = {}) => {
  const filter = buildUserFilter({ search, banned });
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
exports.resolvePendingReport = (reportId, adminId, status, adminNote) =>
  Report.findOneAndUpdate(
    { _id: reportId, status: 'pending' },
    {
      $set: {
        status,
        resolvedBy: adminId,
        resolvedAt: new Date(),
        adminNote,
      },
    },
    { returnDocument: 'after' }
  );

// ✅ FIX BUG-03: حُذفت findPendingReports و buildPendingFilter (Dead Code)
// الدالة الوحيدة المستخدمة هي findPendingReportsWithCounts

// ── السجلات ───────────────────────────────────────────────────
exports.logAdminAction = ({
  adminId, action, targetId, targetModel,
  reason, meta, targetName, adminNote,
}) =>
  AdminLog.create({
    adminId, action, targetId, targetModel,
    reason, meta, targetName, adminNote,
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
    totalUsers, bannedUsers, totalItems, deliveredItems, pendingReports,
  }));

// ── البلاغات مع العدادات التراكمية ───────────────────────────
exports.findPendingReportsWithCounts = async ({
  page   = 1,
  limit  = 10,
  status = null, // ✅ FIX BUG-06: null = كل الحالات بدون فلتر
  repeatOffenderThreshold = 5,
} = {}) => {
  const skip = (page - 1) * limit;

  // ✅ FIX BUG-06: إذا status=null لا نُقيّد الـ $match بأي حالة
  const matchStage = status ? { status } : {};

  const reports = await Report.aggregate([
    { $match: matchStage },
    { $sort:  { createdAt: -1 } },
    { $skip:  skip },
    { $limit: limit },

    {
      $lookup: {
        from:         'users',
        localField:   'reportedUser',
        foreignField: '_id',
        as:           'reportedUserData',
        pipeline: [{
          $project: {
            name: 1, email: 1, avatar: 1,
            isBanned: 1, trustLevel: 1, trustScore: 1,
          },
        }],
      },
    },
    {
      $lookup: {
        from:         'users',
        localField:   'reporter',
        foreignField: '_id',
        as:           'reporterData',
        pipeline: [{ $project: { name: 1, avatar: 1, trustLevel: 1 } }],
      },
    },
    {
      $lookup: {
        from:         'items',
        localField:   'relatedItem',
        foreignField: '_id',
        as:           'relatedItemData',
        pipeline: [{ $project: { title: 1, imageUrl: 1, status: 1 } }],
      },
    },
    {
      $lookup: {
        from: 'reports',
        let:  { uid: '$reportedUser' },
        pipeline: [
          { $match: { $expr: { $eq: ['$reportedUser', '$$uid'] } } },
          { $count: 'total' },
        ],
        as: 'totalReportsLookup',
      },
    },
    {
      $lookup: {
        from: 'reports',
        let:  { uid: '$reportedUser' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$reportedUser', '$$uid'] },
                  { $eq: ['$status', 'pending'] },
                ],
              },
            },
          },
          { $count: 'total' },
        ],
        as: 'pendingReportsLookup',
      },
    },
    {
      $lookup: {
        from: 'reports',
        let:  { uid: '$reportedUser' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$reportedUser', '$$uid'] },
                  { $eq: ['$status', 'actioned'] },
                ],
              },
            },
          },
          { $count: 'total' },
        ],
        as: 'actionedReportsLookup',
      },
    },
    {
      $addFields: {
        reporter:     { $arrayElemAt: ['$reporterData',     0] },
        reportedUser: { $arrayElemAt: ['$reportedUserData', 0] },
        relatedItem:  { $arrayElemAt: ['$relatedItemData',  0] },
        totalReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$totalReportsLookup.total',   0] }, 0],
        },
        pendingReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$pendingReportsLookup.total', 0] }, 0],
        },
        actionedReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$actionedReportsLookup.total', 0] }, 0],
        },
        isRepeatOffender: {
          $gte: [
            { $ifNull: [{ $arrayElemAt: ['$actionedReportsLookup.total', 0] }, 0] },
            repeatOffenderThreshold,
          ],
        },
      },
    },
    {
      $project: {
        totalReportsLookup:   0,
        pendingReportsLookup: 0,
        actionedReportsLookup: 0,
        reporterData:         0,
        reportedUserData:     0,
        relatedItemData:      0,
      },
    },
  // ✅ FIX BUG-05: حد زمني لحماية الـ DB من الـ slow queries
  ]).option({ maxTimeMS: 10000 });

  const total = await Report.countDocuments(matchStage);
  return { reports, total };
};
