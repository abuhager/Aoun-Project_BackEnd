const { buildGamificationProfile } = require('../utils/gamification');

const toId = (value) => {
  if (!value) return null;
  return String(value._id ?? value);
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * العقد الوحيد لهوية المستخدم التي يمكن إرسالها للواجهة.
 * حقول كلمات المرور وOTP والجلسات لا يمكن أن تدخل هذا الكائن حتى لو تغيّر الاستعلام.
 */
exports.toAuthUser = (user) => ({
  _id:               toId(user),
  name:              user.name,
  email:             user.email,
  phone:             user.phone             ?? null,
  phoneVerified:     Boolean(user.phoneVerified),
  avatar:            user.avatar            ?? '',
  role:              user.role,
  trustScore:        user.trustScore        ?? 0,
  trustLevel:        user.trustLevel        ?? 1,
  quota:             user.quota             ?? 0,
  totalDonations:    user.totalDonations    ?? 0,
  isVerified:        Boolean(user.isVerified),
  isVerifiedStudent: Boolean(user.isVerifiedStudent),
  isBanned:          Boolean(user.isBanned),
  isFrozen:          Boolean(user.isFrozen),
  badges:            user.badges            ?? [],
  createdAt:         toDate(user.createdAt),
  gamification: buildGamificationProfile(
    user.trustScore,
    user.totalDonations
  ),
});

exports.toProfileActivityItem = (item) => ({
  _id:       toId(item),
  title:     item.title,
  category:  item.category,
  status:    item.status,
  imageUrl:  item.imageUrl ?? '',
  // Express يحول Date إلى ISO في JSON؛ إبقاؤه Date داخلياً يحافظ على عقد الخدمة.
  createdAt: item.deliveredAt ?? item.createdAt,
});

exports._private = { toDate, toId };
