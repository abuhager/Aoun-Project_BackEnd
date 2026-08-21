// routes/auth.js
// ✅ [SEC-NEW-04] meLimiter يُطبَّق قبل requireAuth — يمنع DB queries قبل Rate Limit
// ═══════════════════════════════════════════════════════════════
// إصلاحات الجولات السابقة المحفوظة:
// ✅ [ARCH-01]     حذف resendLimiter الـ Inline
// ✅ [SEC-AUTH-01] resend-otp يستخدم schema 'resendOtp'
// ✅ [SEC-04]      token في URL Path
// ✅ [SEC-05]      meLimiter على مسارات /me
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();

const { requireAuth }       = require('../middlewares/auth');
const authController        = require('../controllers/authController');
const validateObjectId      = require('../middlewares/validateObjectId');
const validateBody          = require('../middlewares/validateBody');
const { upload, verifyImageBuffer } = require('../middlewares/upload');

const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
  otpLimiter,
  resendOtpLimiter,
  meLimiter,
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

const validateResetTokenParam = (req, res, next) => {
  if (!/^[a-f\d]{64}$/i.test(req.params.token ?? '')) {
    return res.status(400).json({
      msg: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية',
      code: 'INVALID_RESET_TOKEN',
    });
  }
  return next();
};

router.post('/reset-password/:token',
  resetPasswordLimiter,
  validateResetTokenParam,
  validateBody('resetPassword'),
  authController.resetPassword
);

router.post('/refresh',
  refreshLimiter,
  authController.refreshToken
);

router.get('/profile/:id',
  validateObjectId('id'),
  authController.getPublicProfile
);

// ══════════════════════════════════════════════
// Protected Routes
// ══════════════════════════════════════════════

// ✅ [SEC-NEW-04] meLimiter أولاً — يمنع المهاجم من إرهاق DB عبر requireAuth
// الترتيب الخاطئ: requireAuth → meLimiter (يُنفَّذ DB query قبل الفلترة)
// الترتيب الصحيح: meLimiter → requireAuth (يُوقف الطلب قبل أي عمل)
router.get('/me',
  meLimiter,     // ← أولاً: فلترة بالسرعة
  requireAuth,   // ← ثانياً: التحقق من الهوية
  authController.getMe
);

router.get('/me/profile',
  meLimiter,
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
