// routes/items.js
const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const { upload, verifyImageBuffer } = require('../middlewares/upload');
const validateBody = require('../middlewares/validateBody');
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
  updateItem,
  deleteItem,
} = require('../controllers/itemController');

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV !== 'production' ? 1000 : 20,
  message: { msg: '🛑 محاولات حجز كثيرة جداً، الرجاء الانتظار 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== 'production',
});

router.get('/', getItems);
router.get('/me', requireAuth, getMyItems);
router.get('/:id', validateObjectId('id'), getItemById);

router.post(
  '/',
  requireAuth,
  upload.single('image'),
  verifyImageBuffer,        // ← أضف هذا
  validateBody('createItem'),
  createItem
);

router.put(
  '/book/:id',
  requireAuth,
  requireLevel2,
  bookingLimiter,
  validateObjectId('id'),
  bookItem
);

router.put(
  '/cancel/:id',
  requireAuth,
  requireLevel2,
  bookingLimiter,
  validateObjectId('id'),
  cancelBooking
);

router.put(
  '/complete/:id',
  requireAuth,             
  validateObjectId('id'),
  validateBody('completeDelivery'),
  completeDelivery      
);

router.put(
  '/:id',
  requireAuth,
  upload.single('image'),
  verifyImageBuffer,        // ← أضف هذا
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