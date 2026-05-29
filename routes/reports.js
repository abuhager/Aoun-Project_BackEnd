const express           = require('express');
const router            = express.Router();
const { requireAuth }   = require('../middlewares/auth');
const validateObjectId  = require('../middlewares/validateObjectId');
const validateBody      = require('../middlewares/validateBody'); // ✅ جديد
const reportController  = require('../controllers/reportController');

router.post('/',           requireAuth,                              validateBody('createReport'), reportController.createReport);
router.post('/:id/appeal', requireAuth, validateObjectId('id'),     validateBody('submitAppeal'), reportController.submitAppeal);

module.exports = router;