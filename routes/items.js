// routes/items.js ✅ PATCHED [LOGIC-01 | ARCH-02]
const express = require('express');
const router  = express.Router();

const { requireAuth, optionalAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody');
const { upload, verifyImageBuffer } = require('../middlewares/upload');
const {
  getItems, getMyItems, getItemById,
  createItem, bookItem, cancelBooking,
  leaveWaitlist, completeDelivery,
  updateItem, deleteItem,
} = require('../controllers/itemController');

// ✅ [LOGIC-01]: حقن confirmationType تلقائياً للمستلم
const injectRecipientConfirm = (req, _res, next) => {
  req.body = { ...req.body, confirmationType: 'recipient_confirm' };
  next();
};

// ── قراءة ─────────────────────────────────────────────────────────────────
router.get('/',   optionalAuth, getItems);
router.get('/me', requireAuth,  getMyItems);

router.get(
  '/:id',
  optionalAuth,
  validateObjectId('id'),
  getItemById
);

// ── كتابة ─────────────────────────────────────────────────────────────────
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

router.put(
  '/leave-waitlist/:id',
  requireAuth,
  validateObjectId('id'),
  leaveWaitlist
);

// ✅ [LOGIC-01 | ARCH-02]: Route موحّد للمستلم — POST /:id/confirm-receipt
// يُطابق ما يستدعيه itemApi.ts فعلياً
router.post(
  '/:id/confirm-receipt',
  requireAuth,
  validateObjectId('id'),
  injectRecipientConfirm,    // ← يحقن { confirmationType: 'recipient_confirm' }
  completeDelivery
);

// ✅ [ARCH-02]: Route موحّد للمتبرع — POST /:id/confirm-delivery (بدل PUT /complete/:id)
router.post(
  '/:id/confirm-delivery',
  requireAuth,
  validateObjectId('id'),
  validateBody('completeDelivery'),
  completeDelivery
);

// ← نُبقي PUT /complete/:id للتوافق مع أي client قديم (Deprecated)
router.put(
  '/complete/:id',
  requireAuth,
  validateObjectId('id'),
  validateBody('completeDelivery'),
  completeDelivery
);

// ── تعديل وحذف ────────────────────────────────────────────────────────────
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