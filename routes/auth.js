const express       = require('express');
const router        = express.Router();
const auth          = require('../middlewares/auth');
const authController = require('../controllers/authController');
const validateObjectId = require('../middlewares/validateObjectId'); // ← أضف هذا
const {
  globalLimiter,
  authLimiter,
  refreshLimiter,
} = require('../middlewares/rateLimiter');

router.post('/register',        authLimiter,  authController.register);
router.post('/verify-email',    authLimiter,  authController.verifyEmail);
router.post('/login',           authLimiter,  authController.login);
router.post('/forgot-password', authLimiter,  authController.forgotPassword);
router.post('/reset-password',  authLimiter,  authController.resetPassword);
router.get('/me',               auth,         authController.getUserProfile);
router.get('/profile/:id',      globalLimiter, validateObjectId('id'), authController.getPublicProfile); // ✅
router.post('/refresh',         refreshLimiter, authController.refreshToken);
router.post('/logout',          auth,         authController.logout);

module.exports = router;