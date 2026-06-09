// controllers/authController.js ✅ النسخة المصحّحة الكاملة
const authService      = require('../services/authService');
const asyncHandler     = require('../utils/asyncHandler');
const AppError         = require('../utils/AppError');
const userRepository   = require('../repositories/userRepository');

// ✅ إصلاح C4 — استيراد upload و verifyImageBuffer معاً
const { upload, verifyImageBuffer } = require('../middlewares/upload');

const {
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
} = require('../utils/tokenUtils');

const isProduction = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────
// ✅ إصلاح C1, C2, C3 — session_active cookie helpers
// httpOnly: false → مرئي للـ Next.js Edge Middleware
// ─────────────────────────────────────────────────────────────
const SESSION_ACTIVE_OPTIONS = {
  httpOnly: false,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // نفس عمر refreshToken
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
  return res.status(result.statusCode).json(result.body);
});

// ─── 3. تسجيل الدخول ──────────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const result = await authService.loginLogic(req.body);

  if (result.statusCode === 200 && result.refreshToken) {
    // ✅ refreshToken — httpOnly (آمن)
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

    // ✅ إصلاح C1 — session_active signal للـ Next.js middleware
    res.cookie('session_active', '1', SESSION_ACTIVE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 4. بروفايل المستخدم الخاص ────────────────────────────────
exports.getUserProfile = asyncHandler(async (req, res) => {
  const result = await authService.getUserProfileLogic(req.user.id);
  return res.status(result.statusCode).json(result.body);
});

// ─── 5. GET /me — payload كامل للـ AuthContext ────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.user.id);

  if (!user) {
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  }

  return res.json({
    _id:         user._id,
    name:        user.name,
    email:       user.email,
    avatar:      user.avatar,
    role:        user.role,
    trustLevel:  user.trustLevel  ?? 1,
    trustScore:  user.trustScore  ?? 0,
    quota:       user.quota       ?? 0,
    isVerified:  user.isVerified,
    gamification: user.gamification ?? null,
  });
});

// ─── 6. بروفايل عام ────────────────────────────────────────────
exports.getPublicProfile = asyncHandler(async (req, res) => {
  const result = await authService.getPublicProfileLogic(req.params.id);
  return res.status(result.statusCode).json(result.body);
});

// ─── 7. نسيت كلمة المرور ──────────────────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  // ✅ إصلاح C5 — تمرير object بدلاً من string مباشر
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
    // ✅ إصلاح C3 — امسح الاثنين معاً
    res.clearCookie('refreshToken',    CLEAR_REFRESH_COOKIE_OPTIONS);
    res.clearCookie('session_active',  CLEAR_SESSION_ACTIVE_OPTIONS);
  }

  if (result.statusCode === 200 && result.newRefreshToken) {
    // ✅ إصلاح C2 — ضبط الاثنين معاً عند كل refresh ناجح
    res.cookie('refreshToken',   result.newRefreshToken, REFRESH_COOKIE_OPTIONS);
    res.cookie('session_active', '1',                    SESSION_ACTIVE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 10. تسجيل الخروج ─────────────────────────────────────────
exports.logout = asyncHandler(async (req, res) => {
  const result = await authService.logoutLogic(req.user.id);

  // ✅ إصلاح C3 — مسح الاثنين معاً
  res.clearCookie('refreshToken',   CLEAR_REFRESH_COOKIE_OPTIONS);
  res.clearCookie('session_active', CLEAR_SESSION_ACTIVE_OPTIONS);

  return res.status(result.statusCode).json(result.body);
});

// ─── 11. تعديل البروفايل ───────────────────────────────────────
// ✅ إصلاح C4 — إضافة verifyImageBuffer بعد upload.single()
exports.updateMe = [
  upload.single('avatar'),
  verifyImageBuffer,           // ← يتحقق من Magic Bytes بعد رفع الملف
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
  // ✅ إصلاح C6 — تمرير object كما تتوقعه authService
  const result = await authService.updatePasswordLogic(req.user.id, {
    currentPassword: req.body.currentPassword,
    newPassword:     req.body.newPassword,
  });

  return res.status(result.statusCode).json(result.body);
});