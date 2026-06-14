// routes/auth.js
// ✅ FIX [ARCH-01]: حذف resendLimiter الـ Inline — استخدام resendOtpLimiter من rateLimiter.js
// ✅ FIX [SEC-AUTH-01]: resend-otp يستخدم schema 'resendOtp' المستقلة (لا تطلب otp)

const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../middlewares/auth');
const authController  = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody');
const { upload, verifyImageBuffer } = require('../middlewares/upload');

const {
  loginLimiter,
  globalLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  otpLimiter,
  resendOtpLimiter,
} = require('../middlewares/rateLimiter');

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
// Public Routes
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

// ✅ FIX [SEC-AUTH-01]: كانت validateBody('verifyEmail') — تطلب otp وتكسر المسار
// الآن: validateBody('resendOtp') — تقبل email فقط كما هو المتوقع
router.post('/resend-otp',
  resendOtpLimiter,
  validateBody('resendOtp'),
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
// Protected Routes
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