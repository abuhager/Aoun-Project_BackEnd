// routes/settings.js
const express            = require('express');
const router             = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const settingsController = require('../controllers/settingsController');

// GET  /api/settings → عام (للـ Frontend يحتاج التصنيفات مثلاً)
router.get('/',  settingsController.getSettings);

// PATCH /api/settings → أدمن فقط
router.patch('/',
  requireAuth,
  requireAdmin,
  settingsController.updateSettings
);

module.exports = router;
