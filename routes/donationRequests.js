const express  = require('express');
const router   = express.Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { requireAuth, requireLevel2 } = require('../middlewares/auth');
const validateObjectId   = require('../middlewares/validateObjectId');
const validateBody       = require('../middlewares/validateBody');
const drController       = require('../controllers/donationRequestController');
const { upload, verifyImageBuffer } = require('../middlewares/upload');

// ✅ إصلاح ERR_ERL_KEY_GEN_IPV6:
//    عند الاعتماد على req.ip كـ fallback يجب تمريره عبر ipKeyGenerator()
//    حتى يتعامل express-rate-limit بشكل صحيح مع IPv6
const strictLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            10,
  standardHeaders: true,
  legacyHeaders:  false,
  message: { msg: 'طلبات كثيرة جداً، يرجى المحاولة بعد دقيقة ⏳', code: 'TOO_MANY_REQUESTS' },
  keyGenerator: (req) =>
    req.user?.id ?? ipKeyGenerator(req),   // ✅ ipKeyGenerator يعالج IPv6 تلقائياً
});

// ── قراءة ────────────────────────────────────────────────────
router.get('/',    requireAuth, drController.getRequests);
router.get('/me',  requireAuth, drController.getMyRequests);

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
  requireLevel2,                       // ← Level 2 مطلوب للتبرع (نفس شرط الـ bookItem)
  validateObjectId('id'),
  upload.single('image'),              // الصورة اختيارية
  verifyImageBuffer,
  validateBody('respondToRequest'),
  drController.respondToRequest
);

module.exports = router;
