const express = require('express');
const router  = express.Router();
const hubCtrl = require('../controllers/hubController');
const validateBody     = require('../middlewares/validateBody'); // ✅ جديد
const { requireAuth, requireAdmin } = require('../middlewares/auth');

router.get(   '/',           hubCtrl.getHubs);
router.get(   '/admin/all',  requireAuth, requireAdmin,                        hubCtrl.getAllAdmin);
router.post(  '/',           requireAuth, requireAdmin, validateBody('createHub'), hubCtrl.createHub);
router.patch( '/:id',        requireAuth, requireAdmin, validateBody('updateHub'), hubCtrl.updateHub);
router.delete('/:id',        requireAuth, requireAdmin,                        hubCtrl.deactivateHub);

module.exports = router;