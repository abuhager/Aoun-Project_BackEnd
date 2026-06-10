const express  = require('express');
const router   = express.Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit'); // ✅ أضف ipKeyGenerator

const { requireAuth } = require('../middlewares/auth');
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
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req), // ✅ بدل req.ip
});

// ── قراءة ────────────────────────────────────────────────────
router.get('/',   requireAuth, drController.getRequests);
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
  validateObjectId('id'),
  drController.cancelRequest
);

router.post(
  '/:id/respond',
  requireAuth,
  validateObjectId('id'),
  upload.single('image'),
  verifyImageBuffer,
  validateBody('respondToRequest'),
  drController.respondToRequest
);

module.exports = router;