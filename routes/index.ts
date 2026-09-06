// routes/index.js — ✅ ARCH-03: Router الجامع لكل API routes
// أنشئ هذا الملف الجديد في مجلد routes/

import { Router } from 'express';
import authRoutes from './auth.js';
import itemRoutes from './items.js';
import phoneRoutes from './phone.js';
import hubRoutes from './hubs.js';
import adminRoutes from './admin.js';
import ratingRoutes from './ratings.js';
import reportRoutes from './reports.js';
import notificationRoutes from './notifications.js';
import leaderboardRoutes from './leaderboard.js';
import settingsRoutes from './settings.js';
import donationRequestRoutes from './donationRequests.js';
import conversationRoutes from './conversationRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/items', itemRoutes);
router.use('/phone', phoneRoutes);
router.use('/hubs', hubRoutes);
router.use('/admin', adminRoutes);
router.use('/ratings', ratingRoutes);
router.use('/reports', reportRoutes);
router.use('/notifications', notificationRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/settings', settingsRoutes);
router.use('/donation-requests', donationRequestRoutes);
router.use('/conversations', conversationRoutes);

export default router;
