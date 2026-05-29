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
  exports.findPendingReportsWithCounts = async ({ page = 1, limit = 20, status = 'pending' } = {}) => {
  const skip = (page - 1) * limit;

  const reports = await Report.aggregate([
    // 1. فلتر حسب الحالة
    { $match: { status } },
    { $sort:  { createdAt: -1 } },
    { $skip:  skip },
    { $limit: limit },

    // 2. بيانات المُبلَّغ عنه
    {
      $lookup: {
        from:       'users',
        localField: 'reportedUser',
        foreignField: '_id',
        as:         'reportedUserData',
        pipeline: [{
          $project: { name: 1, email: 1, avatar: 1, isBanned: 1, trustLevel: 1, trustScore: 1 },
        }],
      },
    },

    // 3. بيانات المُبلِّغ
    {
      $lookup: {
        from:         'users',
        localField:   'reporter',
        foreignField: '_id',
        as:           'reporterData',
        pipeline: [{ $project: { name: 1, avatar: 1, trustLevel: 1 } }],
      },
    },

    // 4. الغرض المرتبط (اختياري)
    {
      $lookup: {
        from:         'items',
        localField:   'relatedItem',
        foreignField: '_id',
        as:           'relatedItemData',
        pipeline: [{ $project: { title: 1, imageUrl: 1, status: 1 } }],
      },
    },

    // 5. ✅ العداد التراكمي — كل البلاغات ضد نفس المستخدم (بكل الحالات)
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

    // 6. ✅ عداد البلاغات المعلقة فقط
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

    // 7. تسطيح النتائج
    {
      $addFields: {
        reportedUserData: { $arrayElemAt: ['$reportedUserData', 0] },
        reporterData:     { $arrayElemAt: ['$reporterData',     0] },
        relatedItemData:  { $arrayElemAt: ['$relatedItemData',  0] },

        // ✅ إجمالي البلاغات على الشخص (بكل الحالات)
        totalReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$totalReportsLookup.total',  0] }, 0],
        },
        // ✅ البلاغات المعلقة فقط
        pendingReportsAgainstUser: {
          $ifNull: [{ $arrayElemAt: ['$pendingReportsLookup.total', 0] }, 0],
        },
        // ✅ علم خطر: أكثر من 3 بلاغات
        isRepeatOffender: {
          $gt: [
            { $ifNull: [{ $arrayElemAt: ['$totalReportsLookup.total', 0] }, 0] },
            3,
          ],
        },
      },
    },

    // 8. إزالة الحقول المؤقتة
    {
      $project: {
        totalReportsLookup:   0,
        pendingReportsLookup: 0,
      },
    },
  ]);

  const total = await Report.countDocuments({ status });
  return { reports, total };
};
