import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import validateBody from '../middlewares/validateBody.js';
import { actionLimiter } from '../middlewares/rateLimiter.js';
import ratingController from '../controllers/ratingController.js';

const router            = express.Router();

router.post('/',         requireAuth, actionLimiter, validateBody('submitRating'), ratingController.submitRating);
router.get('/pending',   requireAuth,                               ratingController.getPendingRating);
router.get('/user/:id',  validateObjectId('id'),                    ratingController.getUserRatings);

export default router;
