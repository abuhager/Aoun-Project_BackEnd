import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import validateBody from '../middlewares/validateBody.js';
import { actionLimiter } from '../middlewares/rateLimiter.js';
import reportController from '../controllers/reportController.js';

const router            = express.Router();

router.post('/',           requireAuth, actionLimiter,                         validateBody('createReport'), reportController.createReport);
router.post('/:id/appeal', requireAuth, actionLimiter, validateObjectId('id'), validateBody('submitAppeal'), reportController.submitAppeal);

export default router;
