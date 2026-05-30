// repositories/adminRepository.js — النسخة النهائية والمُحصّنة بالكامل

const User     = require('../models/User');
const Item     = require('../models/Item');
const Report   = require('../models/Report');
const AdminLog = require('../models/AdminLog');

// ── مساعد: تهريب أحرف RegExp وتحديد الطول لمنع هجمات ReDoS ──────────
const getSafeSearchRegex = (search) => {
  if (!search) return null;
  // 1. تحديد طول المدخلات (بحد أقصى 100 حرف) لمنع العمليات الطويلة جداً
  const truncated = String(search).slice(0, 100);
  // 2. تهريب الأحرف الخاصة بـ Regex
  const escaped = truncated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
};

// ── المستخدمون ────────────────────────────────────────────────
exports.findAllUsers = ({ page = 1, limit = 20, search } = {}) => {
  const searchRegex = getSafeSearchRegex(search);
  const filter = searchRegex
    ? {
        $or: [
          { name:  searchRegex }, // ✅ مُعالَج ومحمي من الـ ReDoS وطول النص
          { email: searchRegex }, // ✅ مُعالَج ومحمي من الـ ReDoS وطول النص
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
  const searchRegex = getSafeSearchRegex(search);
  const filter = searchRegex
    ? {
        $or: [
          { name:  searchRegex },
          { email: searchRegex },
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

exports.findPendingReports = async ({ page = 1, limit = 20 } = {}) => {
  const reports = await Report.find(pendingFilter)
    .populate('reporter',     'name email phone')
    .populate('reportedUser', 'name email phone isBanned')
    .populate('relatedItem',  'title')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const reportedIds = reports.map(r => r.reportedUser?._id).filter(Boolean);

  const counts = await Report.aggregate([
    { $match: { reportedUser: { $in: reportedIds } } },
    { $group: { _id: '$reportedUser', count: { $sum: 1 } } },
  ]);

  const countMap = Object.fromEntries(counts.map(c => [c._id.toString(), c.count]));

  return reports.map(r => ({
    ...r,
    totalReportsAgainstUser: countMap[r.reportedUser?._id?.toString()] ?? 0,
  }));
};
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

// ── البلاغات مع العدادات التراكمية ───────────────────────────
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
        from:         'users',
        localField:   'reportedUser',
        foreignField: '_id',
        as:           'reportedUserData',
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

    // 5. العداد التراكمي — كل البلاغات ضد نفس المستخدم (بكل الحالات)
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

    // 6. عداد البلاغات المعلقة فقط
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