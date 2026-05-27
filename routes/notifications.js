// routes/notifications.js
const express  = require('express');
const router   = express.Router();
const { requireAuth } = require('../middlewares/auth');
const ctrl = require('../controllers/notificationController');

router.get('/',           requireAuth, ctrl.getNotifications);   // جلب آخر 20
router.patch('/read-all', requireAuth, ctrl.markAllRead);        // تعليم الكل مقروء
router.patch('/:id/read', requireAuth, ctrl.markOneRead);        // تعليم واحد مقروء

module.exports = router;