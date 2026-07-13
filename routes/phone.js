// routes/phone.js
const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/authMiddleware');
const phoneCtrl  = require('../controllers/phoneController');

// ─── Firebase Phone Auth (الجديد) ────────────────────────────
// Frontend يرسل idToken بعد تأكيد OTP عبر Firebase Client SDK
router.post('/verify-token', protect, phoneCtrl.verifyToken);

// ─── Deprecated (Twilio) — تُرجع 410 Gone ───────────────────
router.post('/send-otp',    protect, phoneCtrl.sendOtp);
router.post('/verify-otp',  protect, phoneCtrl.verifyOtp);

module.exports = router;
