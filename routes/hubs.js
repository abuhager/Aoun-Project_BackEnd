// routes/hubs.js — ✅ PATCHED [BUG-01 | SEC-01 | SEC-02]

const express         = require('express');
const router          = express.Router();
const hubCtrl         = require('../controllers/hubController');
const validateBody    = require('../middlewares/validateBody');
const validateObjectId = require('../middlewares/validateObjectId');
const { requireAuth, requireAdmin }     = require('../middlewares/auth');
const { publicLimiter }                 = require('../middlewares/rateLimiter');

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

module.exports = router;
