import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import authController from '../controllers/authController.js';
import validateObjectId from '../middlewares/validateObjectId.js';
import validateBody from '../middlewares/validateBody.js';
import { upload, verifyImageBuffer } from '../middlewares/upload.js';
import { requireTrustedBrowserRequest, setPrivateNoStore } from '../middlewares/requestSecurity.js';
import { loginLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter, refreshLimiter, otpLimiter, resendOtpLimiter, meLimiter, publicLimiter, uploadLimiter } from '../middlewares/rateLimiter.js';

const router  = express.Router();

router.use(setPrivateNoStore);

const conditionalUploadRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('multipart/form-data')) {
    return uploadLimiter(req, res, next);
  }
  return next();
};

const conditionalUpload = (req: Request, res: Response, next: NextFunction) => {
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('multipart/form-data')) {
    return upload.single('avatar')(req, res, next);
  }
  next();
};

const conditionalVerify = (req: Request, res: Response, next: NextFunction) => {
  if (req.file) return verifyImageBuffer(req, res, next);
  next();
};

// ══════════════════════════════════════════════
// Public Routes
// ══════════════════════════════════════════════

router.post('/register',
  registerLimiter,
  requireTrustedBrowserRequest,
  validateBody('register'),
  authController.register
);

router.post('/verify-email',
  otpLimiter,
  requireTrustedBrowserRequest,
  validateBody('verifyEmail'),
  authController.verifyEmail
);

router.post('/resend-otp',
  resendOtpLimiter,
  requireTrustedBrowserRequest,
  validateBody('resendOtp'),
  authController.resendOtp
);

router.post('/login',
  loginLimiter,
  requireTrustedBrowserRequest,
  validateBody('login'),
  authController.login
);

router.post('/forgot-password',
  forgotPasswordLimiter,
  requireTrustedBrowserRequest,
  validateBody('forgotPassword'),
  authController.forgotPassword
);

router.post('/reset-password',
  resetPasswordLimiter,
  requireTrustedBrowserRequest,
  validateBody('resetPassword'),
  authController.resetPassword
);

router.post('/refresh',
  refreshLimiter,
  requireTrustedBrowserRequest,
  authController.refreshToken
);

router.get('/profile/:id',
  publicLimiter,
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
  requireTrustedBrowserRequest,
  requireAuth,
  authController.logout
);

router.put('/me',
  meLimiter,
  requireAuth,
  conditionalUploadRateLimit,
  conditionalUpload,
  conditionalVerify,
  validateBody('updateMe'),
  authController.updateMe
);

router.put('/me/password',
  meLimiter,
  requireTrustedBrowserRequest,
  requireAuth,
  validateBody('updatePassword'),
  authController.updatePassword
);

export default router;
