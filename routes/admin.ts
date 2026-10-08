import express from 'express';
import { openAdminConversation } from '../services/supportService.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import validateBody from '../middlewares/validateBody.js';
import adminController from '../controllers/adminController.js';

const router           = express.Router();

router.use(requireAuth, requireAdmin);

router.post('/users/:id/conversation', validateObjectId('id'), async (req, res) => {
  res.json({ conversation: await openAdminConversation(req.user!.id, String(req.params.id)) });
});

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

export default router;
