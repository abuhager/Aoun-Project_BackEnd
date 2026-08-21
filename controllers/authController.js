// controllers/authController.js
// ✅ FIX [SEC-03]       : SESSION_ACTIVE_OPTIONS.maxAge ديناميكي من env
// ✅ FIX [SEC-CTRL-01]  : resetPassword يستخدم req.params.token لا req.body.token
// ✅ FIX [PERF-CTRL-01] : parsePage مع حد أقصى + حماية من skip سالب
// ✅ FIX [DUP-CTRL-01]  : parsePage دالة مشتركة تحذف التكرار
// ✅ FIX [ARCH-CTRL-01] : SESSION_ACTIVE_OPTIONS مستورد من tokenUtils — لا تعريف محلي
// ✅ FIX [LOGIC-CTRL-01]: phone validation بـ regex قبل تمريره للـ Service

const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

const {
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
  SESSION_ACTIVE_OPTIONS,        // ✅ [ARCH-CTRL-01] مستورد من tokenUtils
  CLEAR_SESSION_ACTIVE_OPTIONS,  // ✅ [ARCH-CTRL-01] مستورد من tokenUtils
} = require('../utils/tokenUtils');

const { isValidJordanPhone } = require('../utils/phoneUtils');

// ✅ [PERF-CTRL-01] + [DUP-CTRL-01] دالة مشتركة لتحليل رقم الصفحة بأمان
// تمنع: page سالب، page=0، page=NaN، page عالٍ جداً
const parsePage = (raw) => {
  const p = parseInt(raw, 10);
  return (!p || p < 1) ? 1 : Math.min(p, 500);
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

// ─── 2b. إعادة إرسال OTP ──────────────────────────────────────
exports.resendOtp = asyncHandler(async (req, res) => {
  const result = await authService.resendOtpLogic({ email: req.body.email });
  return res.status(result.statusCode).json(result.body);
});

// ─── 3. تسجيل الدخول ──────────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const result = await authService.loginLogic(req.body);

  if (result.statusCode === 200 && result.refreshToken) {
    res.cookie('refreshToken',   result.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.cookie('session_active', '1',                 SESSION_ACTIVE_OPTIONS);
  }

  return res.status(result.statusCode).json(result.body);
});

// ─── 4. بروفايل المستخدم الخاص ────────────────────────────────
exports.getUserProfile = asyncHandler(async (req, res) => {
  // ✅ [PERF-CTRL-01] parsePage تمنع skip سالب أو عالٍ جداً
  const page   = parsePage(req.query.page);
  const result = await authService.getMeLogic(req.user.id, page);
  return res.status(result.statusCode).json(result.body);
});

// ─── 5. GET /me ───────────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const result = await authService.getCurrentUserLogic(req.user.id);
  return res.status(result.statusCode).json(result.body);
});

// ─── 6. بروفايل عام ───────────────────────────────────────────
exports.getPublicProfile = asyncHandler(async (req, res) => {
  // ✅ [PERF-CTRL-01] نفس الحماية على الـ public profile
  const page   = parsePage(req.query.page);
  const result = await authService.getPublicProfileLogic(req.params.id, page);
  return res.status(result.statusCode).json(result.body);
});

// ─── 7. نسيت كلمة المرور ──────────────────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPasswordLogic({ email: req.body.email });
  return res.status(result.statusCode).json(result.body);
});

// ─── 8. إعادة تعيين كلمة المرور ───────────────────────────────
exports.resetPassword = asyncHandler(async (req, res) => {
  // ✅ [SEC-CTRL-01] req.params.token بدل req.body.token
  // المسار /reset-password/:token — الـ token في URL Path لا في الـ body
  // منع تسريبه في Server Logs أو Proxy Logs التي تُسجّل الـ body
  const result = await authService.resetPasswordLogic(
    req.params.token,
    req.body.password
  );
  return res.status(result.statusCode).json(result.body);
});

// ─── 9. تجديد الـ Token ───────────────────────────────────────
exports.refreshToken = asyncHandler(async (req, res) => {
  const clientIp = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

  const result = await authService.refreshLogic(
    req.cookies?.refreshToken,
    clientIp
  );

  if (result.clearCookie) {
    res.clearCookie('refreshToken',   CLEAR_REFRESH_COOKIE_OPTIONS);
    res.clearCookie('session_active', CLEAR_SESSION_ACTIVE_OPTIONS);
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

// ─── 11. تعديل البروفايل ──────────────────────────────────────
exports.updateMe = asyncHandler(async (req, res) => {
  const updates = {};

  if (req.body?.name?.trim()) {
    updates.name = req.body.name.trim();
  }

  if (req.body?.phone?.trim()) {
    const phone = req.body.phone.trim();
    // ✅ [LOGIC-CTRL-01] التحقق من صيغة الهاتف الأردني قبل تمريره للـ Service
    // يمنع إدخال أرقام مشوهة أو دولية غير مدعومة تصل إلى DB
    if (!isValidJordanPhone(phone)) {
      return res.status(400).json({
        msg:  'صيغة رقم الهاتف غير صحيحة ❌ — يجب أن يكون بصيغة +9627XXXXXXXX',
        code: 'INVALID_PHONE_FORMAT',
      });
    }
    updates.phone = phone;
  }

  const result = await authService.updateMeLogic(
    req.user.id,
    updates,
    req.file?.buffer,
    req.file?.mimetype
  );

  return res.status(result.statusCode).json(result.body);
});

// ─── 12. تغيير كلمة المرور ────────────────────────────────────
exports.updatePassword = asyncHandler(async (req, res) => {
  const result = await authService.updatePasswordLogic(req.user.id, {
    currentPassword: req.body.currentPassword,
    newPassword:     req.body.newPassword,
  });
  return res.status(result.statusCode).json(result.body);
});
