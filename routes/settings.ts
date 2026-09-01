// routes/settings.js
const express            = require('express');
const router             = express.Router();
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin, // DC-05: middleware جديد — انظر middlewares/auth.js
} = require('../middlewares/auth');
const validateBody       = require('../middlewares/validateBody');
const settingsController = require('../controllers/settingsController');

// ── Public — بدون auth ────────────────────────────────────────────────────────
// يرجع categories + reportReasons فقط — آمن للجميع
router.get('/public', settingsController.getPublicSettings);

// ── Admin فقط — قراءة الإعدادات الكاملة ──────────────────────────────────────
// admin عادي يحتاج يرى الإعدادات لغرض المراقبة
router.get(
  '/',
  requireAuth,
  requireAdmin,
  settingsController.getSettings
);

// ── DC-05 FIX: Super Admin فقط — تعديل الإعدادات ─────────────────────────────
// كان: requireAdmin (أي admin يقدر يعدّل)
// صار: requireSuperAdmin (super_admin فقط)
// السبب: تعديل الإعدادات يؤثر على النظام بالكامل — خطر عالي
router.patch(
  '/',
  requireAuth,
  requireSuperAdmin,                        // ← DC-05
  validateBody('updateSettings'),
  settingsController.updateSettings
);

module.exports = router;