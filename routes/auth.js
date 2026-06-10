// routes/auth.js ✅ النسخة المصحّحة الكاملة والجاهزة للإنتاج والتوزيع المركزي
const express = require('express');
const router  = express.Router();

const { requireAuth }    = require('../middlewares/auth');
const authController     = require('../controllers/authController');
const validateObjectId   = require('../middlewares/validateObjectId');
const validateBody       = require('../middlewares/validateBody');
const { upload, verifyImageBuffer } = require('../middlewares/upload');
const rateLimit          = require('express-rate-limit');

// استيراد المحدِّدات الصحيحة والمؤكدة من الـ Middleware
const {
  loginLimiter,
  globalLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  otpLimiter,
} = require('../middlewares/rateLimiter');

// ✅ إصلاح المسار 3️⃣: Rate Limiter مخصص ومشدد لـ resend-otp لمنع الـ Email Bombing
const resendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: {
    msg: 'تجاوزت الحد المسموح لإعادة الإرسال، انتظر 10 دقائق ⛔',
    code: 'RESEND_RATE_LIMITED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ [BUG FIX] يمنع "Unexpected end of form" عند إرسال JSON بدون صورة
// multer/busboy يتحطم إذا شغّلناه على طلب Content-Type: application/json
// الحل: نشغّله فقط إذا كان الطلب multipart/form-data فعلاً
const conditionalUpload = (req, res, next) => {
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('multipart/form-data')) {
    return upload.single('avatar')(req, res, next);
  }
  next(); // JSON بدون صورة → تخطى multer بالكامل
};

const conditionalVerify = (req, res, next) => {
  if (req.file) return verifyImageBuffer(req, res, next);
  next(); // لا ملف → لا فحص Magic Bytes
};

// ══════════════════════════════════════════════
// Public Routes — لا تحتاج auth
// ══════════════════════════════════════════════

// التسجيل
router.post(
  '/register',
  registerLimiter,
  validateBody('register'),
  authController.register
);

// التحقق من الإيميل (OTP)
router.post(
  '/verify-email',
  otpLimiter,
  validateBody('verifyEmail'),
  authController.verifyEmail
);

// ✅ إعادة إرسال الـ OTP بـ حماية مخصصة ومحدِّد صارم
router.post(
  '/resend-otp',
  resendLimiter,
  validateBody('verifyEmail'),
  authController.resendOtp
);

// تسجيل الدخول
router.post(
  '/login',
  loginLimiter,
  validateBody('login'),
  authController.login
);

// نسيت كلمة المرور
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validateBody('forgotPassword'),
  authController.forgotPassword
);

// إعادة تعيين كلمة المرور
router.post(
  '/reset-password',
  forgotPasswordLimiter,
  validateBody('resetPassword'),
  authController.resetPassword
);

// تجديد الـ Token (Refresh)
router.post(
  '/refresh',
  globalLimiter,
  authController.refreshToken
);

// بروفايل عام (public)
router.get(
  '/profile/:id',
  validateObjectId('id'),
  authController.getPublicProfile
);

// ══════════════════════════════════════════════
// Protected Routes — تحتاج requireAuth
// ══════════════════════════════════════════════

// بيانات المستخدم المسجّل (للـ AuthContext)
router.get(
  '/me',
  requireAuth,
  authController.getMe
);

// بروفايل كامل للمستخدم المسجّل
router.get(
  '/me/profile',
  requireAuth,
  authController.getUserProfile
);

// تسجيل الخروج
router.post(
  '/logout',
  requireAuth,
  authController.logout
);

// ✅ [FIXED] تعديل البروفايل — conditionalUpload يمنع crash عند JSON بدون صورة
router.put(
  '/me',
  requireAuth,
  conditionalUpload,   // ← بدل upload.single('avatar')
  conditionalVerify,   // ← بدل verifyImageBuffer
  validateBody('updateMe'),
  authController.updateMe
);

// تغيير كلمة المرور
router.put(
  '/me/password',
  requireAuth,
  validateBody('updatePassword'),
  authController.updatePassword
);

module.exports = router;