const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit'); // استيراد المكتبة

const { requireAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody = require('../middlewares/validateBody');
const drController = require('../controllers/donationRequestController');

// ✅ إعداد Rate Limiter للعمليات الحساسة
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 دقيقة
  max: 10,             // السماح بـ 10 طلبات كحد أقصى في الدقيقة
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'طلبات كثيرة جداً، يرجى المحاولة بعد دقيقة ⏳', code: 'TOO_MANY_REQUESTS' },
  // الاعتماد على هوية المستخدم لتفادي حظر الـ IP المشترك بالخطأ
  keyGenerator: (req) => req.user?.id || req.ip, 
});

// ── قراءة ────────────────────────────────────────────────────
router.get('/', requireAuth, drController.getRequests);
router.get('/me', requireAuth, drController.getMyRequests);

// ── كتابة ────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  strictLimiter, // ✅ تطبيق الحماية هنا
  validateBody('createDonationRequest'),
  drController.createRequest
);

router.patch(
  '/:id/cancel',
  requireAuth,
  validateObjectId('id'),
  drController.cancelRequest
);

module.exports = router;