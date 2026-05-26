// routes/auth.js
const express        = require('express');
const router         = express.Router();

const { requireAuth } = require('../middlewares/auth');

const authController   = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId');
const {
  globalLimiter,
  authLimiter,
  refreshLimiter,
  registerLimiter,        // ✅ جديد
  forgotPasswordLimiter,  // ✅ جديد
  otpLimiter,             // ✅ جديد
} = require('../middlewares/rateLimiter');

router.post('/register',        registerLimiter,        authController.register);
router.post('/verify-email',    otpLimiter,             authController.verifyEmail);
router.post('/login',           authLimiter,            authController.login);
router.post('/forgot-password', forgotPasswordLimiter,  authController.forgotPassword);
router.post('/reset-password',  authLimiter,            authController.resetPassword);

router.get( '/me',              requireAuth,            authController.getMe);
router.get( '/me/profile',      requireAuth,            authController.getUserProfile);
router.get( '/profile/:id',     globalLimiter,          validateObjectId('id'), authController.getPublicProfile);

router.post('/refresh',         refreshLimiter,         authController.refreshToken);
router.post('/logout',          requireAuth,            authController.logout);

module.exports = router;