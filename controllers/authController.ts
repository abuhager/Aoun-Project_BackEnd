import authService from '../services/authService.js';
import type { LoginInput, RegistrationInput, VerificationInput } from '../services/authService.js';
import type { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { REFRESH_COOKIE_NAME, LEGACY_REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS, CLEAR_REFRESH_COOKIE_OPTIONS, LEGACY_CLEAR_REFRESH_COOKIE_OPTIONS, SESSION_ACTIVE_OPTIONS, CLEAR_SESSION_ACTIVE_OPTIONS } from '../utils/tokenUtils.js';
import { isValidJordanPhone } from '../utils/phoneUtils.js';

// ✅ [PERF-CTRL-01] + [DUP-CTRL-01] دالة مشتركة لتحليل رقم الصفحة بأمان
// تمنع: page سالب، page=0، page=NaN، page عالٍ جداً
const parsePage = (raw: unknown) => {
  const p = parseInt(String(raw ?? ''), 10);
  return (!p || p < 1) ? 1 : Math.min(p, 500);
};

const clearSessionCookies = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, CLEAR_REFRESH_COOKIE_OPTIONS);
  if (REFRESH_COOKIE_NAME !== LEGACY_REFRESH_COOKIE_NAME) {
    res.clearCookie(
      LEGACY_REFRESH_COOKIE_NAME,
      LEGACY_CLEAR_REFRESH_COOKIE_OPTIONS
    );
  }
  res.clearCookie('session_active', CLEAR_SESSION_ACTIVE_OPTIONS);
};

const setSessionCookies = (res: Response, refreshToken: string) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);
  if (REFRESH_COOKIE_NAME !== LEGACY_REFRESH_COOKIE_NAME) {
    res.clearCookie(
      LEGACY_REFRESH_COOKIE_NAME,
      LEGACY_CLEAR_REFRESH_COOKIE_OPTIONS
    );
  }
  res.cookie('session_active', '1', SESSION_ACTIVE_OPTIONS);
};

const readRefreshCookie = (req: Request): string | null => (
  req.cookies?.[REFRESH_COOKIE_NAME]
  ?? req.cookies?.[LEGACY_REFRESH_COOKIE_NAME]
  ?? null
);

export const register = asyncHandler(async (req, res) => {
  const result = await authService.registerLogic(req.body as RegistrationInput);
  return res.status(result.statusCode).json(result.body);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmailLogic(req.body as VerificationInput);

  if (result.statusCode === 200 && result.refreshToken) {
    setSessionCookies(res, result.refreshToken);
  }

  return res.status(result.statusCode).json(result.body);
});

export const resendOtp = asyncHandler(async (req, res) => {
  const result = await authService.resendOtpLogic({ email: String(req.body.email) });
  return res.status(result.statusCode).json(result.body);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.loginLogic(req.body as LoginInput);

  if (result.statusCode === 200 && result.refreshToken) {
    setSessionCookies(res, result.refreshToken);
  }

  return res.status(result.statusCode).json(result.body);
});

export const getUserProfile = asyncHandler(async (req, res) => {
  // ✅ [PERF-CTRL-01] parsePage تمنع skip سالب أو عالٍ جداً
  const page   = parsePage(req.query.page);
  const result = await authService.getMeLogic(req.user!.id, page);
  return res.status(result.statusCode).json(result.body);
});

export const getMe = asyncHandler(async (req, res) => {
  const result = await authService.getCurrentUserLogic(req.user!.id);
  return res.status(result.statusCode).json(result.body);
});

export const getPublicProfile = asyncHandler(async (req, res) => {
  // ✅ [PERF-CTRL-01] نفس الحماية على الـ public profile
  const page   = parsePage(req.query.page);
  const result = await authService.getPublicProfileLogic(req.params.id, page);
  return res.status(result.statusCode).json(result.body);
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPasswordLogic({ email: String(req.body.email) });
  return res.status(result.statusCode).json(result.body);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPasswordLogic(
    String(req.body.token),
    String(req.body.password)
  );
  return res.status(result.statusCode).json(result.body);
});

export const refreshToken = asyncHandler(async (req, res) => {
  const clientIp = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

  const result = await authService.refreshLogic(
    readRefreshCookie(req),
    clientIp
  );

  if (result.clearCookie) {
    clearSessionCookies(res);
  }

  if (result.statusCode === 200 && result.newRefreshToken) {
    setSessionCookies(res, result.newRefreshToken);
  }

  return res.status(result.statusCode).json(result.body);
});

export const logout = asyncHandler(async (req, res) => {
  const result = await authService.logoutLogic(req.user!.id);
  clearSessionCookies(res);
  return res.status(result.statusCode).json(result.body);
});

export const updateMe = asyncHandler(async (req, res) => {
  const updates: { name?: string; phone?: string } = {};

  const rawName = req.body.name;
  const rawPhone = req.body.phone;

  if (typeof rawName === 'string' && rawName.trim()) {
    updates.name = rawName.trim();
  }

  if (typeof rawPhone === 'string' && rawPhone.trim()) {
    const phone = rawPhone.trim();
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

  if (Object.keys(updates).length === 0 && !req.file) {
    return res.status(400).json({
      msg: 'لم يتم إرسال أي تغيير للملف الشخصي',
      code: 'NO_PROFILE_CHANGES',
    });
  }

  const result = await authService.updateMeLogic(
    req.user!.id,
    updates,
    req.file?.buffer,
    req.file?.mimetype
  );

  return res.status(result.statusCode).json(result.body);
});

export const updatePassword = asyncHandler(async (req, res) => {
  const result = await authService.updatePasswordLogic(req.user!.id, {
    currentPassword: String(req.body.currentPassword),
    newPassword:     String(req.body.newPassword),
  });

  if (result.statusCode === 200) {
    clearSessionCookies(res);
  }

  return res.status(result.statusCode).json(result.body);
});

export const _private = {
  clearSessionCookies,
  readRefreshCookie,
  setSessionCookies,
};

export default { register, verifyEmail, resendOtp, login, getUserProfile, getMe, getPublicProfile, forgotPassword, resetPassword, refreshToken, logout, updateMe, updatePassword, _private };
