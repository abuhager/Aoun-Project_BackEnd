const express  = require('express');
const router   = express.Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { requireAuth, optionalAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody');
const drController     = require('../controllers/donationRequestController');
const { upload, verifyImageBuffer } = require('../middlewares/upload');

const strictLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { msg: 'طلبات كثيرة جداً، يرجى المحاولة بعد دقيقة ⏳', code: 'TOO_MANY_REQUESTS' },
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
});

// ── قراءة ────────────────────────────────────────────────────
router.get('/',   optionalAuth, drController.getRequests);
router.get('/me', requireAuth, drController.getMyRequests);

// ── كتابة ────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  strictLimiter,
  validateBody('createDonationRequest'),
  drController.createRequest
);

router.patch(
  '/:id/cancel',
  requireAuth,
  strictLimiter,
  validateObjectId('id'),
  drController.cancelRequest
);

// ✅ Route الجديد — المتبرع يقدم عرضه (بديل /:id/respond)
router.post(
  '/:id/offer',
  requireAuth,
  strictLimiter,
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
  strictLimiter,
  validateObjectId('id'),
  validateObjectId('offerId'),
  drController.acceptOffer
);

router.patch(
  '/:id/offers/:offerId/reject',
  requireAuth,
  strictLimiter,
  validateObjectId('id'),
  validateObjectId('offerId'),
  drController.rejectOffer
);

router.patch(
  '/:id/offers/:offerId/withdraw',
  requireAuth,
  strictLimiter,
  validateObjectId('id'),
  validateObjectId('offerId'),
  drController.withdrawOffer
);

module.exports = router;
