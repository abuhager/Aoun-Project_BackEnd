// services/leaderboardService.js
const User = require('../models/User');
const { buildGamificationProfile } = require('../utils/gamification');

const LEADERBOARD_LIMIT = 20;

exports.getLeaderboard = async () => {
  const users = await User.find({ isBanned: false, isVerified: true })
    .select('name avatar trustScore totalDonations')
    .sort({ trustScore: -1, totalDonations: -1 })
    .limit(LEADERBOARD_LIMIT)
    .lean();

  return users.map((u, index) => ({
    rank:          index + 1,
    _id:           u._id,
    name:          u.name,
    avatar:        u.avatar,
    ...buildGamificationProfile(u.trustScore, u.totalDonations),
  }));
};

exports.getUserRank = async (userId) => {
  const user = await User.findById(userId)
    .select('trustScore totalDonations')
    .lean();

  if (!user)
    throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });

  const rank = await User.countDocuments({
    isBanned:   false,
    isVerified: true,
    trustScore: { $gt: user.trustScore },
  }) + 1;

  return {
    rank,
    ...buildGamificationProfile(user.trustScore, user.totalDonations),
  };
};