const express           = require('express');
const router            = express.Router();
const { requireAuth }   = require('../middlewares/auth');
const validateObjectId  = require('../middlewares/validateObjectId');
const validateBody      = require('../middlewares/validateBody'); // ✅ جديد
const { actionLimiter } = require('../middlewares/rateLimiter');
const reportController  = require('../controllers/reportController');

router.post('/',           requireAuth, actionLimiter,                         validateBody('createReport'), reportController.createReport);
router.post('/:id/appeal', requireAuth, actionLimiter, validateObjectId('id'), validateBody('submitAppeal'), reportController.submitAppeal);

module.exports = router;
