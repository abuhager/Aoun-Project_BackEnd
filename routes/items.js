// routes/items.js
const express = require('express');
const router  = express.Router();

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

const injectDonorConfirm = (req, _res, next) => {
  req.body = { ...req.body, confirmationType: 'donor_confirm' };
  next();
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
  injectDonorConfirm,
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
