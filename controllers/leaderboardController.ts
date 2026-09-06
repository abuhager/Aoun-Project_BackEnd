import leaderboardService from '../services/leaderboardService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getLeaderboard = asyncHandler(async (_req, res) => {
  const leaderboard = await leaderboardService.getLeaderboard();
  return res.json({ leaderboard });
});

export const getUserRank = asyncHandler(async (req, res) => {
  const rank = await leaderboardService.getUserRank(req.user!.id);
  return res.json(rank);
});

export default { getLeaderboard, getUserRank };
