import express from 'express';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middlewares/auth.js';
import validateBody from '../middlewares/validateBody.js';
import settingsController from '../controllers/settingsController.js';

const router             = express.Router();

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

export default router;