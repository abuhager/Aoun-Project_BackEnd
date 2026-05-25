// routes/auth.js
const express        = require('express');
const router         = express.Router();

// ✅ الإصلاح — destructure بدل استخدام auth مباشرةً
const { requireAuth } = require('../middlewares/auth');  // ← السطر 3

const authController   = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId');
const {
  globalLimiter,
  authLimiter,
  refreshLimiter,
} = require('../middlewares/rateLimiter');

router.post('/register',        authLimiter,   authController.register);
router.post('/verify-email',    authLimiter,   authController.verifyEmail);
router.post('/login',           authLimiter,   authController.login);
router.post('/forgot-password', authLimiter,   authController.forgotPassword);
router.post('/reset-password',  authLimiter,   authController.resetPassword);
router.get( '/me',         requireAuth, authController.getMe);
router.get( '/me/profile', requireAuth, authController.getUserProfile); // ← كامل — لصفحة Profile فقط

router.get( '/profile/:id',     globalLimiter, validateObjectId('id'), authController.getPublicProfile);
router.post('/refresh',         refreshLimiter, authController.refreshToken);
router.post('/logout',          requireAuth,   authController.logout);              // ✅ كان: auth

module.exports = router;