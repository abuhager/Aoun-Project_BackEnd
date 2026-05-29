const express           = require('express');
const router            = express.Router();
const { requireAuth }   = require('../middlewares/auth');
const validateObjectId  = require('../middlewares/validateObjectId');
const validateBody      = require('../middlewares/validateBody'); // ✅ جديد
const ratingController  = require('../controllers/ratingController');

router.post('/',         requireAuth, validateBody('submitRating'), ratingController.submitRating);
router.get('/pending',   requireAuth,                               ratingController.getPendingRating);
router.get('/user/:id',  validateObjectId('id'),                    ratingController.getUserRatings);

module.exports = router;