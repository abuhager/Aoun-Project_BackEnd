import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { meLimiter } from '../middlewares/rateLimiter.js';
import leaderboardController from '../controllers/leaderboardController.js';

const router                = express.Router();

// لوحة المتصدرين متاحة لكل حساب مسجّل دخوله، وليست API عامة.
router.get('/',   meLimiter, requireAuth, leaderboardController.getLeaderboard);
router.get('/me', meLimiter, requireAuth, leaderboardController.getUserRank);

export default router;
