// services/leaderboardService.js
const userRepository = require('../repositories/userRepository');
const { buildGamificationProfile } = require('../utils/gamification');

const LEADERBOARD_LIMIT = 20;

exports.getLeaderboard = async () => {
  const users = await userRepository.findLeaderboardUsers(LEADERBOARD_LIMIT);

  return users.map((u, index) => ({
    rank:          index + 1,
    _id:           u._id,
    name:          u.name,
    avatar:        u.avatar,
    ...buildGamificationProfile(u.trustScore, u.totalDonations),
  }));
};

exports.getUserRank = async (userId) => {
  const user = await userRepository.findLeaderboardUser(userId);

  if (!user) {
    return {
      eligible: false,
      reason: 'لوحة المتصدرين مخصصة للمستخدمين المفعّلين غير المحظورين',
    };
  }

  const rank = await userRepository.countLeaderboardUsersAhead(user) + 1;

  return {
    eligible: true,
    rank,
    ...buildGamificationProfile(user.trustScore, user.totalDonations),
  };
};
