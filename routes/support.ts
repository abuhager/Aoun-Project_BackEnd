import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import { donationActionLimiter } from '../middlewares/rateLimiter.js';
import * as service from '../services/supportService.js';
import AppError from '../utils/AppError.js';
const router = Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
  const page = Math.max(1, Math.min(10000, Math.floor(Number(req.query.page) || 1)));
  res.json(await service.listSupport(req.user!.id, false, page));
});
router.get('/inbox', requireAdmin, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Math.floor(Number(req.query.page) || 1)));
  res.json(await service.listSupport(req.user!.id, true, page));
});
router.post('/', donationActionLimiter, async (req, res) => {
  const subject = req.body?.subject;
  if (typeof subject !== 'string' || subject.trim().length < 3 || subject.trim().length > 150) {
    throw new AppError('عنوان المشكلة مطلوب (3–150 حرفاً)', 422, 'INVALID_SUPPORT_SUBJECT');
  }
  res.json({ conversation: await service.openSupport(req.user!.id, subject.trim()) });
});
router.post('/:id/claim', requireAdmin, validateObjectId('id'), async (req, res) => {
  res.json({ conversation: await service.claimSupport(String(req.params.id), req.user!.id) });
});
router.post('/:id/resolve', requireAdmin, validateObjectId('id'), async (req, res) => {
  res.json(await service.resolveSupport(String(req.params.id), req.user!.id));
});
export default router;
