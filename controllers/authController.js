// controllers/authController.js
const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/userRepository');
const upload = require('../middlewares/upload');

const {
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
} = require('../utils/tokenUtils');

// ─── 1. التسجيل ────────────────────────────────────────
exports.register = asyncHandler(async (req, res) => {
  const result = await authService.registerLogic(req.body);
  return res.status(result.statusCode).json(result.body);
});

// ─── 2. تأكيد الإيميل ─────────────────────────────────
exports.verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmailLogic(req.body);
  return res.status(result.statusCode).json(result.body);
});

// ─── 3. تسجيل الدخول ──────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const result = await authService.loginLogic(req.body);

  if (result.statusCode === 200 && result.refreshToken) {
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 4. بروفايل المستخدم الخاص (GET /me/profile) ──────
exports.getUserProfile = asyncHandler(async (req, res) => {
  const result = await authService.getUserProfileLogic(req.user.id);
  return res.status(result.statusCode).json(result.body);
});

// ─── 5. GET /me — minimal payload للـ AuthContext ─────
exports.getMe = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.user.id);

  if (!user) {
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  }

  return res.json({
    _id:        user._id,
    name:       user.name,
    email:      user.email,
    avatar:     user.avatar,
    role:       user.role,
    trustLevel: user.trustLevel ?? 1,
    trustScore: user.trustScore ?? 0,
    quota:      user.quota ?? 0,
    isVerified: user.isVerified,
  });
});

// ─── 6. بروفايل عام (GET /profile/:id) ────────────────
exports.getPublicProfile = asyncHandler(async (req, res) => {
  const result = await authService.getPublicProfileLogic(req.params.id);
  return res.status(result.statusCode).json(result.body);
});

// ─── 7. نسيت كلمة المرور ──────────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPasswordLogic(req.body.email);
  return res.status(result.statusCode).json(result.body);
});

// ─── 8. إعادة تعيين كلمة المرور ───────────────────────
exports.resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPasswordLogic(
    req.body.token,
    req.body.password
  );
  return res.status(result.statusCode).json(result.body);
});

// ─── 9. refreshToken ──────────────────────────────────
exports.refreshToken = asyncHandler(async (req, res) => {
  const result = await authService.refreshLogic(req.cookies?.refreshToken);

  if (result.clearCookie) {
    res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS);
  }

  if (result.statusCode === 200 && result.newRefreshToken) {
    res.cookie('refreshToken', result.newRefreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 10. logout ───────────────────────────────────────
exports.logout = asyncHandler(async (req, res) => {
  const result = await authService.logoutLogic(req.user.id);
  res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS);
  return res.status(result.statusCode).json(result.body);
});

// ─── 11. PUT /me — تعديل البروفايل ────────────────────
exports.updateMe = [
  upload.single('avatar'),
  asyncHandler(async (req, res) => {
    const updates = {};

    if (req.body.name?.trim()) {
      updates.name = req.body.name.trim();
    }

    if (req.body.phone?.trim()) {
      updates.phone = req.body.phone.trim();
    }

    const result = await authService.updateMeLogic(
      req.user.id,
      updates,
      req.file?.buffer,
      req.file?.mimetype
    );

    return res.status(result.statusCode).json(result.body);
  }),
];

// ─── 12. PUT /me/password — تغيير كلمة المرور ────────
exports.updatePassword = asyncHandler(async (req, res) => {
  const result = await authService.updatePasswordLogic(
    req.user.id,
    req.body.currentPassword,
    req.body.newPassword
  );

  return res.status(result.statusCode).json(result.body);
});