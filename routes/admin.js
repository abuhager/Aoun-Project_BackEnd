// routes/admin.js
// كل المسارات هنا محمية بـ requireAuth + requireAdmin تلقائياً
const express          = require('express');
const router           = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const adminController  = require('../controllers/adminController');

// ✅ Middleware عام على كل مسارات هذا الـ router
router.use(requireAuth, requireAdmin);

// ─── إدارة مستويات الثقة ──────────────────────────────────────
router.post('/users/:id/promote', validateObjectId('id'), adminController.promoteUser);
router.post('/users/:id/demote',  validateObjectId('id'), adminController.demoteUser);

// ─── Phase 6: مسارات إضافية ستُضاف هنا ──────────────────────
// router.get('/users',           adminController.listUsers);
// router.get('/items',           adminController.listItems);
// router.get('/reports',         adminController.listReports);
// router.get('/logs',            adminController.listAuditLogs);
// router.post('/users/:id/ban',  validateObjectId('id'), adminController.banUser);

module.exports = router;