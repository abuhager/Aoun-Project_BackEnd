// routes/index.js — ✅ ARCH-03: Router الجامع لكل API routes
// أنشئ هذا الملف الجديد في مجلد routes/

const router = require('express').Router();

router.use('/auth',              require('./auth'));
router.use('/items',             require('./items'));
router.use('/phone',             require('./phone'));
router.use('/hubs',              require('./hubs'));
router.use('/admin',             require('./admin'));
router.use('/ratings',           require('./ratings'));
router.use('/reports',           require('./reports'));
router.use('/notifications',     require('./notifications'));
router.use('/leaderboard',       require('./leaderboard'));
router.use('/settings',          require('./settings'));
router.use('/donation-requests', require('./donationRequests'));
router.use('/conversations',     require('./conversations'));

module.exports = router;