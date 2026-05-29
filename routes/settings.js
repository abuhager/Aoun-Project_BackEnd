const express            = require('express');
const router             = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const validateBody       = require('../middlewares/validateBody'); // ✅ جديد
const settingsController = require('../controllers/settingsController');

router.get('/',  settingsController.getSettings);
router.patch('/', requireAuth, requireAdmin, validateBody('updateSettings'), settingsController.updateSettings);

module.exports = router;