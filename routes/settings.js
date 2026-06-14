// routes/settings.js
const express            = require('express');
const router             = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const validateBody       = require('../middlewares/validateBody');
const settingsController = require('../controllers/settingsController');

// ✅ Public — بدون auth — يرجع categories + reportReasons فقط
router.get('/public', settingsController.getPublicSettings);

// ✅ [CRIT-2 FIX] كان مكشوفاً للجميع — الآن Admin فقط
// كان يكشف: autoReportBanThreshold, universityEmailDomains, trustScorePerDonation...
router.get('/', requireAuth, requireAdmin, settingsController.getSettings);

// ✅ Admin فقط
router.patch('/', requireAuth, requireAdmin, validateBody('updateSettings'), settingsController.updateSettings);

module.exports = router;