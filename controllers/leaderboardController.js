// controllers/leaderboardController.js
const leaderboardService = require('../services/leaderboardService');

exports.getLeaderboard = async (req, res) => {
  try {
    const leaderboard = await leaderboardService.getLeaderboard();
    return res.json({ leaderboard });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
};

exports.getUserRank = async (req, res) => {
  try {
    const rank = await leaderboardService.getUserRank(req.user.id);
    return res.json(rank);
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message });
  }
};