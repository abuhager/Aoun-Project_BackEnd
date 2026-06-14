// routes/auth.js
// ✅ FIX [ARCH-01]: حذف resendLimiter الـ Inline — استخدام resendOtpLimiter من rateLimiter.js

const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../middlewares/auth');
const authController  = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody');
const { upload, verifyImageBuffer } = require('../middlewares/upload');

// ✅ FIX [ARCH-01]: resendOtpLimiter قادم من المصدر الموحّد
const {
  loginLimiter,
  globalLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  otpLimiter,
  resendOtpLimiter,      // ✅ FIX [ARCH-01]: لا يوجد inline rateLimit هنا بعد الآن
} = require('../middlewares/rateLimiter');

// ✅ يمنع "Unexpected end of form" عند إرسال JSON بدون صورة
const conditionalUpload = (req, res, next) => {
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('multipart/form-data')) {
    return upload.single('avatar')(req, res, next);
  }
  next();
};

const conditionalVerify = (req, res, next) => {
  if (req.file) return verifyImageBuffer(req, res, next);
  next();
};

// ══════════════════════════════════════════════
// Public Routes — لا تحتاج auth
// ══════════════════════════════════════════════

router.post('/register',
  registerLimiter,
  validateBody('register'),
  authController.register
);

router.post('/verify-email',
  otpLimiter,
  validateBody('verifyEmail'),
  authController.verifyEmail
);

// ✅ FIX [ARCH-01]: resendOtpLimiter من rateLimiter.js — لا magic numbers هنا
router.post('/resend-otp',
  resendOtpLimiter,
  validateBody('verifyEmail'),
  authController.resendOtp
);

router.post('/login',
  loginLimiter,
  validateBody('login'),
  authController.login
);

router.post('/forgot-password',
  forgotPasswordLimiter,
  validateBody('forgotPassword'),
  authController.forgotPassword
);

router.post('/reset-password',
  forgotPasswordLimiter,
  validateBody('resetPassword'),
  authController.resetPassword
);

router.post('/refresh',
  globalLimiter,
  authController.refreshToken
);

router.get('/profile/:id',
  validateObjectId('id'),
  authController.getPublicProfile
);

// ══════════════════════════════════════════════
// Protected Routes — تحتاج requireAuth
// ══════════════════════════════════════════════

router.get('/me',
  requireAuth,
  authController.getMe
);

router.get('/me/profile',
  requireAuth,
  authController.getUserProfile
);

router.post('/logout',
  requireAuth,
  authController.logout
);

router.put('/me',
  requireAuth,
  conditionalUpload,
  conditionalVerify,
  validateBody('updateMe'),
  authController.updateMe
);

router.put('/me/password',
  requireAuth,
  validateBody('updatePassword'),
  authController.updatePassword
);

module.exports = router;