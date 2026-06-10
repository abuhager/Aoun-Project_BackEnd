// controllers/authController.js ✅ النسخة المصحّحة الكاملة والآمنة معمارياً
const authService      = require('../services/authService');
const asyncHandler     = require('../utils/asyncHandler');

const { upload, verifyImageBuffer } = require('../middlewares/upload');

const {
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
} = require('../utils/tokenUtils');

const isProduction = process.env.NODE_ENV === 'production';

const SESSION_ACTIVE_OPTIONS = {
  httpOnly: false,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, 
  path:     '/',
};

const CLEAR_SESSION_ACTIVE_OPTIONS = {
  httpOnly: false,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',
};

// ─── 1. التسجيل ────────────────────────────────────────────────
exports.register = asyncHandler(async (req, res) => {
  const result = await authService.registerLogic(req.body);
  return res.status(result.statusCode).json(result.body);
});

// ─── 2. تأكيد الإيميل ─────────────────────────────────────────
exports.verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmailLogic(req.body);

  if (result.statusCode === 200 && result.refreshToken) {
    res.cookie('refreshToken',   result.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.cookie('session_active', '1',                 SESSION_ACTIVE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 2b. ✅ إعادة إرسال OTP ───────────────────────────────────────
exports.resendOtp = asyncHandler(async (req, res) => {
  // تمرير الكائن المتوقع للـ Service
  const result = await authService.resendOtpLogic({ email: req.body.email });
  return res.status(result.statusCode).json(result.body);
});

// ─── 3. تسجيل الدخول ──────────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const result = await authService.loginLogic(req.body);

  if (result.statusCode === 200 && result.refreshToken) {
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.cookie('session_active', '1', SESSION_ACTIVE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 4. بروفايل المستخدم الخاص ────────────────────────────────
exports.getUserProfile = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const result = await authService.getMeLogic(req.user.id, page); 
  return res.status(result.statusCode).json(result.body);
});

// ─── 5. GET /me ──────────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const result = await authService.getCurrentUserLogic(req.user.id);
  return res.status(result.statusCode).json(result.body);
});

// ─── 6. بروفايل عام ────────────────────────────────────────────
exports.getPublicProfile = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const result = await authService.getPublicProfileLogic(req.params.id, page);
  return res.status(result.statusCode).json(result.body);
});

// ─── 7. نسيت كلمة المرور ──────────────────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPasswordLogic({ email: req.body.email });
  return res.status(result.statusCode).json(result.body);
});

// ─── 8. إعادة تعيين كلمة المرور ────────────────────────────────
exports.resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPasswordLogic(
    req.body.token,
    req.body.password
  );
  return res.status(result.statusCode).json(result.body);
});

// ─── 9. تجديد الـ Token ────────────────────────────────────────
exports.refreshToken = asyncHandler(async (req, res) => {
  const result = await authService.refreshLogic(req.cookies?.refreshToken);

  if (result.clearCookie) {
    res.clearCookie('refreshToken',    CLEAR_REFRESH_COOKIE_OPTIONS);
    res.clearCookie('session_active',  CLEAR_SESSION_ACTIVE_OPTIONS);
  }

  if (result.statusCode === 200 && result.newRefreshToken) {
    res.cookie('refreshToken',   result.newRefreshToken, REFRESH_COOKIE_OPTIONS);
    res.cookie('session_active', '1',                    SESSION_ACTIVE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 10. تسجيل الخروج ─────────────────────────────────────────
exports.logout = asyncHandler(async (req, res) => {
  const result = await authService.logoutLogic(req.user.id);
  res.clearCookie('refreshToken',   CLEAR_REFRESH_COOKIE_OPTIONS);
  res.clearCookie('session_active', CLEAR_SESSION_ACTIVE_OPTIONS);
  return res.status(result.statusCode).json(result.body);
});

// ─── 11. تعديل البروفايل ───────────────────────────────────────
exports.updateMe = [
  upload.single('avatar'),
  verifyImageBuffer,           
  asyncHandler(async (req, res) => {
    const updates = {};

    if (req.body.name?.trim())  updates.name  = req.body.name.trim();
    if (req.body.phone?.trim()) updates.phone = req.body.phone.trim();

    const result = await authService.updateMeLogic(
      req.user.id,
      updates,
      req.file?.buffer,
      req.file?.mimetype
    );

    return res.status(result.statusCode).json(result.body);
  }),
];

// ─── 12. تغيير كلمة المرور ────────────────────────────────────
exports.updatePassword = asyncHandler(async (req, res) => {
  const result = await authService.updatePasswordLogic(req.user.id, {
    currentPassword: req.body.currentPassword,
    newPassword:     req.body.newPassword,
  });
  return res.status(result.statusCode).json(result.body);
});