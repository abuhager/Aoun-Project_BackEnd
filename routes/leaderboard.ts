// routes/leaderboard.js
const express               = require('express');
const router                = express.Router();
const { requireAuth }       = require('../middlewares/auth');
const { meLimiter }         = require('../middlewares/rateLimiter');
const leaderboardController = require('../controllers/leaderboardController');

// لوحة المتصدرين متاحة لكل حساب مسجّل دخوله، وليست API عامة.
router.get('/',   meLimiter, requireAuth, leaderboardController.getLeaderboard);
router.get('/me', meLimiter, requireAuth, leaderboardController.getUserRank);

module.exports = router;
