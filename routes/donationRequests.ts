import express from 'express';
import { requireAuth, optionalAuth } from '../middlewares/auth.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import validateBody from '../middlewares/validateBody.js';
import drController from '../controllers/donationRequestController.js';
import { upload, verifyImageBuffer } from '../middlewares/upload.js';
import { donationActionLimiter, uploadLimiter } from '../middlewares/rateLimiter.js';

const router   = express.Router();

// ── قراءة ────────────────────────────────────────────────────
router.get('/',   optionalAuth, drController.getRequests);
router.get('/me', requireAuth, drController.getMyRequests);

// ── كتابة ────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  donationActionLimiter,
  validateBody('createDonationRequest'),
  drController.createRequest
);

router.patch(
  '/:id/cancel',
  requireAuth,
  donationActionLimiter,
  validateObjectId('id'),
  drController.cancelRequest
);

// ✅ Route الجديد — المتبرع يقدم عرضه (بديل /:id/respond)
router.post(
  '/:id/offer',
  requireAuth,
  donationActionLimiter,
  uploadLimiter,
  validateObjectId('id'),
  upload.single('image'),
  verifyImageBuffer,
  validateBody('respondToRequest'),
  drController.submitOffer
);

// ── طلب واحد ─────────────────────────────────────────────────
router.get(
  '/:id',
  optionalAuth,          // ✅ بدل requireAuth
  validateObjectId('id'),
  drController.getRequestById
);

// ── العروض — خاص بصاحب الطلب (يحتاج تسجيل) ──────────────────
router.get(
  '/:id/offers',
  requireAuth,           // ✅ يبقى requireAuth — لأن العروض سرية
  validateObjectId('id'),
  drController.getOffers
);

router.post(
  '/:id/offers/:offerId/accept',
  requireAuth,
  donationActionLimiter,
  validateObjectId('id'),
  validateObjectId('offerId'),
  drController.acceptOffer
);

router.patch(
  '/:id/offers/:offerId/reject',
  requireAuth,
  donationActionLimiter,
  validateObjectId('id'),
  validateObjectId('offerId'),
  drController.rejectOffer
);

router.patch(
  '/:id/offers/:offerId/withdraw',
  requireAuth,
  donationActionLimiter,
  validateObjectId('id'),
  validateObjectId('offerId'),
  drController.withdrawOffer
);

export default router;
