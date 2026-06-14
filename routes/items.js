// routes/items.js
const express    = require('express');
const rateLimit  = require('express-rate-limit');
const router     = express.Router();

const { upload, verifyImageBuffer } = require('../middlewares/upload');
const validateBody     = require('../middlewares/validateBody');
const validateObjectId = require('../middlewares/validateObjectId');
const { requireAuth, requireLevel2 } = require('../middlewares/auth');

const {
  getItems,
  getMyItems,
  getItemById,
  createItem,
  bookItem,
  cancelBooking,
  completeDelivery,
   leaveWaitlist,
  updateItem,
  deleteItem,
} = require('../controllers/itemController');

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV !== 'production' ? 1000 : 20,
  message: { msg: '🛑 محاولات حجز كثيرة جداً، الرجاء الانتظار 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV !== 'production',
});

// ✅ [CRIT-1 FIX] يحقن confirmationType للمستلم تلقائياً
// السبب: completeDelivery يتوقع req.body.confirmationType
// لكن المستلم يُرسل POST بدون body → كانت النتيجة MISSING_CONFIRMATION_TYPE دائماً
const injectRecipientConfirm = (req, _res, next) => {
  req.body = { ...req.body, confirmationType: 'recipient_confirm' };
  next();
};

// ── Public ──────────────────────────────────────────────────────
router.get('/',    getItems);
router.get('/me',  requireAuth, getMyItems);
router.get('/:id', validateObjectId('id'), getItemById);

// ── Create ──────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  upload.single('image'),
  verifyImageBuffer,
  validateBody('createItem'),
  createItem
);

// ── Booking (Level2 فقط — الحجز يشترط التحقق) ─────────────────
router.put(
  '/book/:id',
  requireAuth,
  requireLevel2,
  bookingLimiter,
  validateObjectId('id'),
  bookItem
);
router.put(
  '/leave-waitlist/:id',
  requireAuth,
  validateObjectId('id'),
  leaveWaitlist   // ← import من controller
);
// ── Cancel Booking ─────────────────────────────────────────────
// ✅ [FIX] حُذف requireLevel2 من هنا
// السبب: cancelBookingLogic يتحقق داخلياً (isBooker || isDonor || inWait)
// المتبرع نفسه قد يكون Level1 ويحتاج إلغاء غرضه المحجوز من شخص آخر
// requireLevel2 كانت تمنعه بدون سبب منطقي
router.put(
  '/cancel/:id',
  requireAuth,
  bookingLimiter,
  validateObjectId('id'),
  cancelBooking
);

// ── Delivery: تأكيد المتبرع (يُرسل body صريح) ─────────────────
router.put(
  '/complete/:id',
  requireAuth,
  validateObjectId('id'),
  validateBody('completeDelivery'),
  completeDelivery
);

// ── [CRIT-1 FIX] تأكيد الاستلام من المستلم ────────────────────
// injectRecipientConfirm يُعبّئ confirmationType قبل الوصول للـ controller
router.post(
  '/:id/confirm-receipt',
  requireAuth,
  validateObjectId('id'),
  injectRecipientConfirm,
  completeDelivery
);

// ── Update / Delete ─────────────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  upload.single('image'),
  verifyImageBuffer,
  validateObjectId('id'),
  validateBody('updateItem'),
  updateItem
);

router.delete(
  '/:id',
  requireAuth,
  validateObjectId('id'),
  deleteItem
);

module.exports = router;