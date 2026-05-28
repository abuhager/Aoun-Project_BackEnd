// routes/reports.js
const express           = require('express');
const router            = express.Router();
const { requireAuth }   = require('../middlewares/auth');
const validateObjectId  = require('../middlewares/validateObjectId');
const reportController  = require('../controllers/reportController');


// ✅ إنشاء بلاغ
router.post('/',             requireAuth, reportController.createReport);

// ✅ تقديم طعن (المتبرع المُبلَّغ عنه)
router.post('/:id/appeal',   requireAuth, validateObjectId('id'), reportController.submitAppeal);

module.exports = router;