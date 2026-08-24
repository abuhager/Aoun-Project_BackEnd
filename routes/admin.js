const express          = require('express');
const router           = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody'); // ✅ جديد
const adminController  = require('../controllers/adminController');

router.use(requireAuth, requireAdmin);

// ─── Stats ────────────────────────────────────────────────────
router.get('/stats', adminController.getStats);

// ─── Users ────────────────────────────────────────────────────
router.get('/users',                                                              adminController.listUsers);
router.post('/users/:id/promote', validateObjectId('id'), validateBody('promoteUser'),  adminController.promoteUser);
router.post('/users/:id/demote',  validateObjectId('id'), validateBody('promoteUser'),  adminController.demoteUser);
router.post('/users/:id/ban',     validateObjectId('id'), validateBody('banUser'),      adminController.banUser);
router.post('/users/:id/unban',   validateObjectId('id'), validateBody('unbanUser'),    adminController.unbanUser);

// ─── Items ────────────────────────────────────────────────────
router.get('/items',                                                              adminController.listItems);
router.delete('/items/:id',       validateObjectId('id'), validateBody('deleteItemAdmin'), adminController.deleteItem);

// ─── Reports ──────────────────────────────────────────────────
router.get('/reports',                                                            adminController.listReports);
router.post('/reports/:id/resolve', validateObjectId('id'), validateBody('resolveReport'), adminController.resolveReport);

// ─── Audit Log ────────────────────────────────────────────────
router.get('/logs', adminController.listAuditLogs);

module.exports = router;
