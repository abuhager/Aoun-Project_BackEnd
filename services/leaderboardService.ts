import userRepository from '../repositories/userRepository.js';
import { buildGamificationProfile } from '../utils/gamification.js';
import type { EntityId } from './serviceTypes.js';

type LeaderboardUser = {
  _id: EntityId;
  name: string;
  avatar?: string;
  trustScore?: number;
  totalDonations?: number;
};

const LEADERBOARD_LIMIT = 20;

export const getLeaderboard = async () => {
  const users = await userRepository.findLeaderboardUsers(LEADERBOARD_LIMIT);

  return users.map((u: LeaderboardUser, index: number) => ({
    rank:          index + 1,
    _id:           u._id,
    name:          u.name,
    avatar:        u.avatar,
    ...buildGamificationProfile(u.trustScore, u.totalDonations),
  }));
};

export const getUserRank = async (userId: EntityId) => {
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

export default { getLeaderboard, getUserRank };
