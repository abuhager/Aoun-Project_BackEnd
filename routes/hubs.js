// routes/hubs.js
// ✅ FIX [HUB-02]: إضافة PATCH /:id/reactivate — كان الـ Service موجوداً بدون route

const express  = require('express');
const router   = express.Router();
const hubCtrl  = require('../controllers/hubController');
const validateBody              = require('../middlewares/validateBody');
const { requireAuth, requireAdmin } = require('../middlewares/auth');

// ── Public ──────────────────────────────────────────────────
router.get('/', hubCtrl.getHubs);

// ── Admin ───────────────────────────────────────────────────
router.get(   '/admin/all',         requireAuth, requireAdmin, hubCtrl.getAllAdmin);
router.post(  '/',                  requireAuth, requireAdmin, validateBody('createHub'),  hubCtrl.createHub);
router.patch( '/:id',               requireAuth, requireAdmin, validateBody('updateHub'),  hubCtrl.updateHub);
router.delete('/:id',               requireAuth, requireAdmin, hubCtrl.deactivateHub);

// ✅ FIX [HUB-02]: route جديد لإعادة تفعيل مركز مُعطَّل
router.patch( '/:id/reactivate',    requireAuth, requireAdmin, hubCtrl.reactivateHub);

module.exports = router;