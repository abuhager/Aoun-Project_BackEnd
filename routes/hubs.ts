import express from 'express';
import hubCtrl from '../controllers/hubController.js';
import validateBody from '../middlewares/validateBody.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { publicLimiter } from '../middlewares/rateLimiter.js';

const router          = express.Router();

// ── Public ──────────────────────────────────────────────────────────────────
// ✅ SEC-02: publicLimiter يحمي DB من الإغراق
router.get('/', publicLimiter, hubCtrl.getHubs);

// ── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin/all', requireAuth, requireAdmin, hubCtrl.getAllAdmin);

router.post(
  '/',
  requireAuth,
  requireAdmin,
  validateBody('createHub'),
  hubCtrl.createHub
);

// ✅ BUG-01: /:id/reactivate يجب أن يأتي قبل /:id — Express يُطابق من الأعلى للأسفل
// ✅ SEC-01: validateObjectId يمنع CastError من Mongoose
router.patch(
  '/:id/reactivate',
  requireAuth,
  requireAdmin,
  validateObjectId('id'),       // ✅ قبل أي DB call
  hubCtrl.reactivateHub
);

router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validateObjectId('id'),       // ✅
  validateBody('updateHub'),    // ✅ BUG-03 مُصلَح في validateBody.js
  hubCtrl.updateHub
);

router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validateObjectId('id'),       // ✅
  hubCtrl.deactivateHub
);

export default router;
