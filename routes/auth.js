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
  windowMs: 10 * 60 * 1000,   // 10 دقائق
  max: 3,                      // 3 طلبات كحد أقصى لكل IP
  message: {
    msg: 'تجاوزت الحد المسموح لإعادة الإرسال، انتظر 10 دقائق ⛔',
    code: 'RESEND_RATE_LIMITED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

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
  validateBody('verifyEmail'), // إعادة استخدام فحص البودي للتأكد من هيكلية وجود الـ email
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

// تعديل البروفايل (مع رفع صورة)
router.put(
  '/me',
  requireAuth,
  upload.single('avatar'),      
  verifyImageBuffer,            
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