// repositories/adminRepository.js
const User     = require('../models/User');
const Item     = require('../models/Item');
const Report   = require('../models/Report');
const AdminLog = require('../models/AdminLog');

// ── مساعد: تهريب أحرف RegExp وتحديد الطول لمنع ReDoS ────────
const getSafeSearchRegex = (search) => {
  if (!search) return null;
  const truncated = String(search).slice(0, 100);
  const escaped   = truncated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
};

// ─── helper داخلي لبناء filter المستخدمين ────────────────────
const buildUserFilter = ({ search, banned = '' } = {}) => {
  const filter = {};

  const searchRegex = getSafeSearchRegex(search);
  if (searchRegex) {
    filter.$or = [
      { name:  searchRegex },
      { email: searchRegex },
    ];
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
const buildPendingFilter = () => ({
  status: 'pending',
  $or: [
    { appealDeadline: { $lte: new Date() } },
    { appealText:     { $exists: true, $ne: null } },
    { appealDeadline: { $exists: false } },
  ],
});

exports.findPendingReports = async ({ page = 1, limit = 20 } = {}) => {
  const filter = buildPendingFilter();

  const reports = await Report.find(filter)
    .populate('reporter',     'name email phone')
    .populate('reportedUser', 'name email phone isBanned')
    .populate('relatedItem',  'title')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const reportedIds = reports
    .map(r => r.reportedUser?._id)
    .filter(Boolean);

  const counts = await Report.aggregate([
    { $match: { reportedUser: { $in: reportedIds } } },
    { $group: { _id: '$reportedUser', count: { $sum: 1 } } },
  ]);

  const countMap = Object.fromEntries(
    counts.map(c => [c._id.toString(), c.count])
  );

  return reports.map(r => ({
    ...r,
    totalReportsAgainstUser:
      countMap[r.reportedUser?._id?.toString()] ?? 0,
  }));
};

exports.countPendingReports = () =>
  Report.countDocuments(buildPendingFilter());

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

// ── البلاغات مع العدادات التراكمية (للداشبورد الكامل) ─────────
exports.findPendingReportsWithCounts = async ({
  page   = 1,
  limit  = 20,
  status = 'pending',
} = {}) => {
  const skip = (page - 1) * limit;

  const reports = await Report.aggregate([
    { $match: { status } },
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
      $addFields: {
        // ✅ الإصلاح: إعادة التسمية لتطابق ما يتوقعه الـ Frontend
        reporter:     { $arrayElemAt: ['$reporterData',     0] },
        reportedUser: { $arrayElemAt: ['$reportedUserData', 0] },
        relatedItem:  { $arrayElemAt: ['$relatedItemData',  0] },
        totalReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$totalReportsLookup.total',  0] }, 0],
        },
        pendingReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$pendingReportsLookup.total', 0] }, 0],
        },
        isRepeatOffender: {
          $gt: [
            { $ifNull: [{ $arrayElemAt: ['$totalReportsLookup.total', 0] }, 0] },
            3,
          ],
        },
      },
    },

    {
      // ✅ حذف كل الأسماء المؤقتة من الـ response النهائي
      $project: {
        totalReportsLookup:   0,
        pendingReportsLookup: 0,
        reporterData:         0,
        reportedUserData:     0,
        relatedItemData:      0,
      },
    },
  ]);

  const total = await Report.countDocuments({ status });
  return { reports, total };
};