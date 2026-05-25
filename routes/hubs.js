// backend/routes/hubs.js
const express  = require('express');
const router   = express.Router();
const hubCtrl  = require('../controllers/hubController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware'); // ✅ middlewares بالـ s

router.get('/',          hubCtrl.getHubs);                              // public
router.post('/',         requireAuth, requireAdmin, hubCtrl.createHub);
router.patch('/:id',     requireAuth, requireAdmin, hubCtrl.updateHub);
router.delete('/:id',    requireAuth, requireAdmin, hubCtrl.deactivateHub);

module.exports = router;