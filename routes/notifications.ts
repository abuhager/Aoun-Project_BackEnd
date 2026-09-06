import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import ctrl from '../controllers/notificationController.js';

const router = express.Router();

router.get('/', requireAuth, ctrl.getNotifications);
router.patch('/read-all', requireAuth, ctrl.markAllRead);
router.patch('/:id/read', requireAuth, validateObjectId('id'), ctrl.markOneRead);

export default router;