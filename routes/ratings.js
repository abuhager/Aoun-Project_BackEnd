// routes/ratings.js
const express           = require('express');
const router            = express.Router();
const { requireAuth }   = require('../middlewares/auth');
const validateObjectId  = require('../middlewares/validateObjectId');
const ratingController  = require('../controllers/ratingController');

// ✅ المستلم يقيّم بعد التسليم
router.post('/',         requireAuth, ratingController.submitRating);
router.get('/pending',   requireAuth, ratingController.getPendingRating); // ✅

// ✅ عرض تقييمات مستخدم (عام)
router.get('/user/:id',  validateObjectId('id'), ratingController.getUserRatings);

module.exports = router;