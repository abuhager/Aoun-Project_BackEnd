import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import phoneCtrl from '../controllers/phoneController.js';
import validateBody from '../middlewares/validateBody.js';
import { phoneVerifyLimiter } from '../middlewares/rateLimiter.js';
import { requirePhoneVerificationEnabled } from '../middlewares/phoneVerificationFeature.js';

const router     = express.Router();

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

export default router;
