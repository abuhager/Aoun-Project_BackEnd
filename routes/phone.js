// routes/phone.js
const express    = require('express');
const router     = express.Router();
const { requireAuth }           = require('../middlewares/auth');
const { sendOtp, verifyOtp }    = require('../controllers/phoneController');
const { otpLimiter }            = require('../middlewares/rateLimiter');

// ─── POST /api/phone/send-otp ────────────────────────────────
// requireAuth: يجب تسجيل الدخول (Level 1)
// otpLimiter:  حماية إضافية على مستوى الـ route
router.post('/send-otp',   requireAuth, otpLimiter, sendOtp);

// ─── POST /api/phone/verify-otp ─────────────────────────────
router.post('/verify-otp', requireAuth, otpLimiter, verifyOtp);

module.exports = router;