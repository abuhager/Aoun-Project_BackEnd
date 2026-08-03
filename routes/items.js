// routes/items.js
const express = require('express');
const router  = express.Router();

// ── Models ─────────────────────────────────────────────────────────────────
const Item = require('../models/Item');

// ── Middlewares ─────────────────────────────────────────────────────────────
const { requireAuth, optionalAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody');
const { upload, verifyImageBuffer } = require('../middlewares/upload');

// ── Controllers ─────────────────────────────────────────────────────────────
const {
  getItems,
  getMyItems,
  getItemById,
  createItem,
  bookItem,
  cancelBooking,
  leaveWaitlist,
  completeDelivery,
  updateItem,
  deleteItem,
} = require('../controllers/itemController');

// ── Custom Middlewares ──────────────────────────────────────────────────────

// ✅ [LOGIC-01]: حقن confirmationType تلقائياً للمستلم
const injectRecipientConfirm = (req, _res, next) => {
  req.body = { ...req.body, confirmationType: 'recipient_confirm' };
  next();
};

// ✅ [ARCH-WAITLIST]: Middleware يمنع الحاجز الفعلي من استخدام leave-waitlist
// يحمي من: استدعاء خاطئ يُلغي الحجز بدل مغادرة الـ Waitlist
const requireWaitlistMember = async (req, res, next) => {
  try {
    const item = await Item.findById(req.params.id)
      .select('waitlist bookedBy')
      .lean();

    if (!item) {
      return res.status(404).json({ success: false, msg: 'الغرض غير موجود' });
    }

    const userId     = req.user.id.toString();
    const inWaitlist = item.waitlist?.some((w) => w.user.toString() === userId);
    const isBooker   = item.bookedBy?.toString() === userId;

    // إذا كان الحاجز الفعلي يستدعي leave-waitlist بالخطأ — أرشده للـ endpoint الصح
    if (isBooker && !inWaitlist) {
      return res.status(400).json({
        success: false,
        code:    'USE_CANCEL_BOOKING',
        msg:     'أنت الحاجز الفعلي — استخدم إلغاء الحجز وليس مغادرة الانتظار',
      });
    }

    if (!inWaitlist && !isBooker) {
      return res.status(400).json({
        success: false,
        code:    'NOT_IN_WAITLIST',
        msg:     'أنت لست في قائمة الانتظار',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

// ── قراءة (Read Routes) ──────────────────────────────────────────────────────
router.get('/', optionalAuth, getItems);
router.get('/me', requireAuth, getMyItems);

router.get(
  '/:id',
  optionalAuth,
  validateObjectId('id'),
  getItemById
);

// ── كتابة وإجراءات (Write & Action Routes) ──────────────────────────────────
router.post(
  '/',
  requireAuth,
  upload.single('image'),
  verifyImageBuffer,
  validateBody('createItem'),
  createItem
);

router.put(
  '/book/:id',
  requireAuth,
  validateObjectId('id'),
  bookItem
);

router.put(
  '/cancel/:id',
  requireAuth,
  validateObjectId('id'),
  cancelBooking
);

// ✅ [ARCH-WAITLIST]: تفعيل requireWaitlistMember لمنع سوء استخدام الـ Endpoint
router.put(
  '/leave-waitlist/:id',
  requireAuth,
  validateObjectId('id'),
  requireWaitlistMember,
  leaveWaitlist
);

// ✅ [LOGIC-01 | ARCH-02]: Route موحّد للمستلم — POST /:id/confirm-receipt
router.post(
  '/:id/confirm-receipt',
  requireAuth,
  validateObjectId('id'),
  injectRecipientConfirm,
  completeDelivery
);

// ✅ [ARCH-02]: Route موحّد للمتبرع — POST /:id/confirm-delivery
router.post(
  '/:id/confirm-delivery',
  requireAuth,
  validateObjectId('id'),
  validateBody('completeDelivery'),
  completeDelivery
);

// ← الإبقاء على PUT /complete/:id للتوافق مع الإصدارات القديمة (Deprecated)
router.put(
  '/complete/:id',
  requireAuth,
  validateObjectId('id'),
  validateBody('completeDelivery'),
  completeDelivery
);

// ── تعديل وحذف (Update & Delete Routes) ────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  validateObjectId('id'),
  upload.single('image'),
  verifyImageBuffer,
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