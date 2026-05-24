const authService = require('../services/authService');
const {
  validateRegister,
  validateVerifyEmail,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
} = require('../dtos/authDto');
const mongoose = require('mongoose');
const {
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
} = require('../utils/tokenUtils');

// ─── 1. التسجيل ────────────────────────────────────────
exports.register = async (req, res) => {
  const { error } = validateRegister(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const result = await authService.registerLogic(req.body);
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 2. تأكيد الإيميل ─────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const { error } = validateVerifyEmail(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const result = await authService.verifyEmailLogic(req.body);
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ msg: 'خطأ في السيرفر أثناء تفعيل الحساب' });
  }
};

// ─── 3. تسجيل الدخول ──────────────────────────────────
exports.login = async (req, res) => {
  const { error } = validateLogin(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const result = await authService.loginLogic(req.body);

    // ازرع الكوكي لو اللوجين نجح
    if (result.statusCode === 200 && result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    }

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 4. بروفايل المستخدم الخاص (GET /me) ───────────────
exports.getUserProfile = async (req, res) => {
  try {
    const result = await authService.getUserProfileLogic(req.user.id);
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 5. بروفايل عام (GET /profile/:id) ─────────────────────
exports.getPublicProfile = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ msg: 'معرف المستخدم غير صحيح' });

  try {
    const result = await authService.getPublicProfileLogic(req.params.id);
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 6. نسيت كلمة المرور ────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { error } = validateForgotPassword(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const result = await authService.forgotPasswordLogic(req.body.email);
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 7. إعادة تعيين كلمة المرور ──────────────────────────
exports.resetPassword = async (req, res) => {
  const { error } = validateResetPassword(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });

  try {
    const result = await authService.resetPasswordLogic(
      req.body.token,
      req.body.password
    );
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 8. refreshToken ─────────────────────────────────────
exports.refreshToken = async (req, res) => {
  try {
    const result = await authService.refreshLogic(req.cookies?.refreshToken); // ✅ refreshLogic

    if (result.clearCookie) {
      res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS);
    }

    if (result.statusCode === 200 && result.newRefreshToken) { // ✅ newRefreshToken
      res.cookie('refreshToken', result.newRefreshToken, REFRESH_COOKIE_OPTIONS);
    }

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err.message);
    res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS);
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};

// ─── 9. logout ───────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    const result = await authService.logoutLogic(req.user.id);
    res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS);
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error(err.message);
    res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS);
    return res.status(500).json({ msg: 'خطأ في السيرفر' });
  }
};