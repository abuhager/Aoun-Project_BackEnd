// routes/hubs.js — PATCHED ✅
// التغييرات: إضافة GET /admin/all + PATCH reactivate

const express = require('express');
const router  = express.Router();
const hubCtrl = require('../controllers/hubController');
const { requireAuth, requireAdmin } = require('../middlewares/auth');

// ── Public ────────────────────────────────────────────────────
router.get('/', hubCtrl.getHubs);                                       // المراكز النشطة فقط

// ── Admin ─────────────────────────────────────────────────────
router.get(   '/admin/all',  requireAuth, requireAdmin, hubCtrl.getAllAdmin);  // ✅ جديد
router.post(  '/',           requireAuth, requireAdmin, hubCtrl.createHub);
router.patch( '/:id',        requireAuth, requireAdmin, hubCtrl.updateHub);
router.delete('/:id',        requireAuth, requireAdmin, hubCtrl.deactivateHub);

module.exports = router;
