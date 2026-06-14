// routes/settings.js
// ✅ FIX [HUB-04]: GET / محمي الآن بـ requireAuth + requireAdmin
//    الإعدادات الحساسة (universityEmailDomains, autoReportBanThreshold...)
//    لا يجب أن تكون مكشوفة للعموم

const express            = require('express');
const router             = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const validateBody       = require('../middlewares/validateBody');
const settingsController = require('../controllers/settingsController');

// ✅ Public — بدون auth — يرجع فقط categories + reportReasons (آمن للـ Frontend)
router.get('/public', settingsController.getPublicSettings);

// ✅ FIX [HUB-04]: مؤمَّن الآن — كان مكشوفاً بدون auth!
router.get('/', requireAuth, requireAdmin, settingsController.getSettings);

// ✅ للأدمن فقط
router.patch('/', requireAuth, requireAdmin, validateBody('updateSettings'), settingsController.updateSettings);

module.exports = router;