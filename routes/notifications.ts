// routes/notifications.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const ctrl = require('../controllers/notificationController');

router.get('/', requireAuth, ctrl.getNotifications);
router.patch('/read-all', requireAuth, ctrl.markAllRead);
router.patch('/:id/read', requireAuth, validateObjectId('id'), ctrl.markOneRead);

module.exports = router;