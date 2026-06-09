// routes/auth.js ✅ النسخة المصحّحة الكاملة
const express = require('express');
const router  = express.Router();

const { requireAuth }    = require('../middlewares/auth');
const authController     = require('../controllers/authController');
const validateObjectId   = require('../middlewares/validateObjectId');
const validateBody       = require('../middlewares/validateBody');

// ✅ إصلاح R1 — استيراد الأسماء الصحيحة الموجودة فعلاً في rateLimiter.js
const {
  loginLimiter,          // كان: authLimiter    ← غير موجود
  globalLimiter,         // كان: refreshLimiter ← غير موجود
  registerLimiter,
  forgotPasswordLimiter,
  otpLimiter,
} = require('../middlewares/rateLimiter');

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

// تسجيل الدخول
router.post(
  '/login',
  loginLimiter,            // ✅ إصلاح R1 — كان authLimiter
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
// ✅ إصلاح R2 — كان otpLimiter وهو خاطئ — reset ليس OTP
router.post(
  '/reset-password',
  forgotPasswordLimiter,
  validateBody('resetPassword'),
  authController.resetPassword
);

// تجديد الـ Token (Refresh)
// ✅ إصلاح R1 — كان refreshLimiter غير موجود → globalLimiter
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
// ملاحظة: validateBody('updateMe') يأتي داخل authController.updateMe
// بعد upload.single() و verifyImageBuffer — لا يوضع هنا
router.put(
  '/me',
  requireAuth,
  authController.updateMe   // ← يحتوي داخله: upload → verifyImageBuffer → asyncHandler
);

// تغيير كلمة المرور
router.put(
  '/me/password',
  requireAuth,
  validateBody('updatePassword'),
  authController.updatePassword
);

module.exports = router;