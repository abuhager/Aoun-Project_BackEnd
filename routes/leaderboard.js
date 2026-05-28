// routes/leaderboard.js
const express               = require('express');
const router                = express.Router();
const { requireAuth }       = require('../middlewares/auth');
const leaderboardController = require('../controllers/leaderboardController');

router.get('/',     leaderboardController.getLeaderboard); // عام
router.get('/me',   requireAuth, leaderboardController.getUserRank); // رتبتي

module.exports = router;