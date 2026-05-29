const express    = require('express');
const router     = express.Router();
const { requireAuth }           = require('../middlewares/auth');
const { sendOtp, verifyOtp }    = require('../controllers/phoneController');
const { otpLimiter }            = require('../middlewares/rateLimiter');
const validateBody              = require('../middlewares/validateBody'); // ✅ جديد

router.post('/send-otp',   requireAuth, otpLimiter, validateBody('sendOtp'),   sendOtp);
router.post('/verify-otp', requireAuth, otpLimiter, validateBody('verifyOtp'), verifyOtp);

module.exports = router;