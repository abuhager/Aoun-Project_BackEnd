// routes/auth.js
const express        = require('express');
const router         = express.Router();

const { requireAuth }  = require('../middlewares/auth');
const authController   = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId');
const {
  authLimiter,
  refreshLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  otpLimiter,
} = require('../middlewares/rateLimiter');

// ── التسجيل والتحقق ───────────────────────────────────────────
router.post('/register',        registerLimiter,       authController.register);
router.post('/verify-email',    otpLimiter,            authController.verifyEmail);

// ── تسجيل الدخول ──────────────────────────────────────────────
router.post('/login',           authLimiter,           authController.login);

// ── استعادة كلمة المرور ───────────────────────────────────────
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password',  otpLimiter,            authController.resetPassword); // ✅ otpLimiter أنسب

// ── البروفايل ─────────────────────────────────────────────────
router.get('/me',               requireAuth,           authController.getMe);
router.get('/me/profile',       requireAuth,           authController.getUserProfile);
router.get('/profile/:id',      validateObjectId('id'), authController.getPublicProfile); // ✅ حذف globalLimiter المكرر

// ── الجلسة ────────────────────────────────────────────────────
router.post('/refresh',         refreshLimiter,        authController.refreshToken);
router.post('/logout',          requireAuth,           authController.logout);

module.exports = router;