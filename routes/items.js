// routes/items.js
const express          = require('express');
const router           = express.Router();
const upload           = require('../middlewares/upload');
const validateObjectId = require('../middlewares/validateObjectId');

const auth                            = require('../middlewares/auth');
const requireAuth                     = auth;
const { requireLevel2, requireAdmin } = auth;
const {
  createItem, getItems, getItemById, getMyItems, getPendingRating,
  updateItem, deleteItem, bookItem, cancelBooking,
  completeDelivery, rateItem, reportUser,
} = require('../controllers/itemController');

// ─── قراءة عامة ──────────────────────────────────────────────
router.get('/',               getItems);
router.get('/me',             requireAuth, getMyItems);
router.get('/pending-rating', requireAuth, getPendingRating);
router.get('/:id',            validateObjectId('id'), getItemById); // ✅ 'id' صريح

// ─── إنشاء وتعديل ────────────────────────────────────────────
router.post('/',
  requireAuth,
  upload.single('image'),
  createItem
);

router.put('/update/:id',
  requireAuth,
  validateObjectId('id'), // ✅
  upload.single('image'),
  updateItem
);

router.delete('/delete/:id',
  requireAuth,
  validateObjectId('id'), // ✅
  deleteItem
);

// ─── حجز وتسليم ──────────────────────────────────────────────
router.put('/book/:id',
  requireAuth,
  requireLevel2,
  validateObjectId('id'), // ✅
  bookItem
);

router.put('/cancel/:id',
  requireAuth,
  validateObjectId('id'), // ✅
  cancelBooking
);

router.put('/complete/:id',
  requireAuth,
  validateObjectId('id'), // ✅
  completeDelivery
);

router.put('/rate/:id',
  requireAuth,
  validateObjectId('id'), // ✅
  rateItem
);

// ─── تبليغ ────────────────────────────────────────────────────
router.post('/report/:userId',
  requireAuth,
  validateObjectId('userId'), // ✅ يقرأ :userId
  reportUser
);

module.exports = router;