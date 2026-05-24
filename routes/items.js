// routes/items.js
// ✅ Phase 1 Fixes:
//    Bug #1  — توحيد URL الـ report: /report/:userId (param) — Backend يقرأ req.params
//    Bug #16 — إضافة bookingLimiter على book + cancel

const express    = require('express');
const router     = express.Router();
const upload = require('../middlewares/upload');

const rateLimit  = require('express-rate-limit');

const { requireAuth, requireLevel2 } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const {
  getItems,
  getMyItems,
  getItemById,
  createItem,
  bookItem,
  cancelBooking,
  completeDelivery,
  rateItem,
  reportUser,
  updateItem,
  deleteItem,
  getPendingRating,
} = require('../controllers/itemController');

// ✅ Fix Bug #16 — Rate Limiter مخصص للحجز/الإلغاء
// يمنع spam الحجز المتعمد (flood attacks على slots)
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max:      process.env.NODE_ENV !== 'production' ? 1000 : 20,
  message:  { msg: '🛑 محاولات حجز كثيرة جداً، الرجاء الانتظار 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV !== 'production',
});

// ── قراءة عامة ────────────────────────────────────────────────
router.get('/',     getItems);
router.get('/me',   requireAuth, getMyItems);
router.get('/pending-rating', requireAuth, getPendingRating);
router.get('/:id',  validateObjectId('id'), getItemById);

// ── كتابة ─────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  upload.single('image'),
  createItem
);

// ✅ Fix Bug #16 — bookingLimiter على book + cancel
router.put(
  '/book/:id',
  requireAuth,
  requireLevel2,
  bookingLimiter,          // ✅ جديد
  validateObjectId('id'),
  bookItem
);

router.put(
  '/cancel/:id',
  requireAuth,
  bookingLimiter,          // ✅ جديد
  validateObjectId('id'),
  cancelBooking
);

router.put(
  '/complete/:id',
  requireAuth,
  validateObjectId('id'),
  completeDelivery
);

router.post(
  '/rate/:id',
  requireAuth,
  validateObjectId('id'),
  rateItem
);

// ✅ Fix Bug #1 — URL موحَّد: /report/:userId (param)
// كان الفرونت يُرسل لـ /report-user وهو URL خاطئ → 404
router.post(
  '/report/:userId',
  requireAuth,
  validateObjectId('userId'),
  reportUser
);

router.put(
  '/:id',
  requireAuth,
  upload.single('image'),
  validateObjectId('id'),
  updateItem
);

router.delete(
  '/:id',
  requireAuth,
  validateObjectId('id'),
  deleteItem
);

module.exports = router;