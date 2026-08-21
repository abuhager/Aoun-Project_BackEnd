// controllers/leaderboardController.js
const leaderboardService = require('../services/leaderboardService');
const asyncHandler = require('../utils/asyncHandler');

exports.getLeaderboard = asyncHandler(async (_req, res) => {
  const leaderboard = await leaderboardService.getLeaderboard();
  return res.json({ leaderboard });
});

exports.getUserRank = asyncHandler(async (req, res) => {
  const rank = await leaderboardService.getUserRank(req.user.id);
  return res.json(rank);
});
