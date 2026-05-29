const express        = require('express');
const router         = express.Router();
const { requireAuth }  = require('../middlewares/auth');
const authController   = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId');
const validateBody     = require('../middlewares/validateBody'); // ✅ جديد
const {
  authLimiter, refreshLimiter,
  registerLimiter, forgotPasswordLimiter, otpLimiter,
} = require('../middlewares/rateLimiter');

router.post('/register',        registerLimiter,       validateBody('register'),        authController.register);
router.post('/verify-email',    otpLimiter,            validateBody('verifyEmail'),      authController.verifyEmail);
router.post('/login',           authLimiter,           validateBody('login'),            authController.login);
router.post('/forgot-password', forgotPasswordLimiter, validateBody('forgotPassword'),   authController.forgotPassword);
router.post('/reset-password',  otpLimiter,            validateBody('resetPassword'),    authController.resetPassword);

router.get('/me',               requireAuth,           authController.getMe);
router.get('/me/profile',       requireAuth,           authController.getUserProfile);
router.get('/profile/:id',      validateObjectId('id'), authController.getPublicProfile);

router.post('/refresh',         refreshLimiter,        authController.refreshToken);
router.post('/logout',          requireAuth,           authController.logout);

module.exports = router;