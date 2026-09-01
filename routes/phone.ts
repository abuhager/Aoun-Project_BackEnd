// routes/phone.js
const express    = require('express');
const router     = express.Router();
const { requireAuth } = require('../middlewares/auth');
const phoneCtrl  = require('../controllers/phoneController');
const validateBody = require('../middlewares/validateBody');
const { phoneVerifyLimiter } = require('../middlewares/rateLimiter');
const {
  requirePhoneVerificationEnabled,
} = require('../middlewares/phoneVerificationFeature');

// ─── Firebase Phone Auth (الجديد) ────────────────────────────
// Frontend يرسل idToken بعد تأكيد OTP عبر Firebase Client SDK
router.post(
  '/verify-token',
  requirePhoneVerificationEnabled,
  requireAuth,
  phoneVerifyLimiter,
  validateBody('verifyPhoneToken'),
  phoneCtrl.verifyToken
);

// ─── Deprecated (Twilio) — تُرجع 410 Gone ───────────────────
router.post('/send-otp',    requireAuth, phoneCtrl.sendOtp);
router.post('/verify-otp',  requireAuth, phoneCtrl.verifyOtp);

module.exports = router;
