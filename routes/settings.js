// routes/settings.js
const express            = require('express');
const router             = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const validateBody       = require('../middlewares/validateBody');
const settingsController = require('../controllers/settingsController');

// ✅ بدون auth — للـ Frontend (categories, reportReasons)
router.get('/public', settingsController.getPublicSettings);

// ✅ بدون auth — الإعدادات الكاملة (للآدمن Dashboard)
router.get('/', settingsController.getSettings);

// ✅ للآدمن فقط
router.patch('/', requireAuth, requireAdmin, validateBody('updateSettings'), settingsController.updateSettings);

module.exports = router;