import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import AppError from '../utils/AppError.js';
import { verifyAccessToken } from '../utils/tokenUtils.js';
import sessionCache from '../utils/sessionCache.js';
import userRepository from '../repositories/userRepository.js';

const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const);

type AuthState = Express.AuthenticatedUser;

const setAuthenticatedResponseHeaders = (res: Response): void => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
};

const getBearerToken = (authorization: unknown): string | null => {
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
};

const loadAuthState = async (userId: unknown): Promise<AuthState | null> => {
  const id = String(userId);
  let state = sessionCache.get(id) as AuthState | null | undefined;
  if (state !== undefined) return state;

  const user = await userRepository.findAuthStateById(id);
  if (!user) return null;

  state = {
    id,
    name: typeof user.name === 'string' ? user.name : '',
    role: Object.values(ROLES).includes(user.role) ? user.role : ROLES.USER,
    trustLevel: Number(user.trustLevel ?? 1),
    phoneVerified: Boolean(user.phoneVerified),
    isVerified: Boolean(user.isVerified),
    isBanned: Boolean(user.isBanned),
    isFrozen: Boolean(user.isFrozen),
    sessionVersion: Number(user.sessionVersion ?? 0),
    sessionIssuedAt: user.sessionIssuedAt ?? null,
  };
  sessionCache.set(id, state);
  return state;
};

const resolveAccessIdentity = async (token: string): Promise<AuthState> => {
  const decoded = verifyAccessToken(token);
  const userId = decoded?.user?.id;

  if (!mongoose.isObjectIdOrHexString(userId)) {
    throw new AppError('بيانات الهوية داخل التوكن غير صالحة', 401, 'INVALID_TOKEN_IDENTITY');
  }

  const state = await loadAuthState(userId);
  if (!state) {
    throw new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND');
  }
  if (state.isBanned) {
    throw new AppError('حسابك محظور 🚫', 403, 'ACCOUNT_BANNED');
  }
  if (state.isFrozen) {
    throw new AppError('حسابك مجمّد مؤقتاً 🧊', 403, 'ACCOUNT_FROZEN');
  }
  if (!state.isVerified) {
    throw new AppError('يجب تفعيل حسابك أولاً 📧', 403, 'EMAIL_NOT_VERIFIED');
  }

  const tokenSessionVersion = Number(decoded.user.sessionVersion ?? 0);
  if (tokenSessionVersion !== state.sessionVersion) {
    sessionCache.invalidate(userId);
    throw new AppError(
      'انتهت صلاحية الجلسة، أعد تسجيل الدخول 🔒',
      401,
      'SESSION_INVALIDATED'
    );
  }

  if (
    state.sessionIssuedAt
    && typeof decoded.iat === 'number'
    && decoded.iat < Math.floor(new Date(state.sessionIssuedAt).getTime() / 1000)
  ) {
    sessionCache.invalidate(userId);
    throw new AppError(
      'انتهت صلاحية الجلسة، أعد تسجيل الدخول 🔒',
      401,
      'SESSION_INVALIDATED'
    );
  }

  return state;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  setAuthenticatedResponseHeaders(res);
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    return next(new AppError('لا يوجد توكن، الوصول مرفوض 🔒', 401, 'NO_TOKEN'));
  }

  try {
    req.user = await resolveAccessIdentity(token);
    return next();
  } catch (error: unknown) {
    if (error instanceof AppError) return next(error);
    const isExpired = error instanceof Error && error.name === 'TokenExpiredError';
    return next(new AppError(
      isExpired ? 'انتهت صلاحية الجلسة ⏰' : 'توكن غير صالح ⚠️',
      401,
      isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    ));
  }
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if (req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
    return next(new AppError('هذه المنطقة للمشرفين فقط 🛡️', 403, 'FORBIDDEN_ADMIN_ONLY'));
  }
  return next();
};

export const requireSuperAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    return next(new AppError(
      'هذه العملية تتطلب صلاحيات مشرف أعلى 🛡️',
      403,
      'FORBIDDEN_SUPER_ADMIN_ONLY'
    ));
  }
  return next();
};

export const requireLevel2 = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if ((req.user.trustLevel ?? 1) < 2) {
    return next(new AppError(
      'هذه الميزة تتطلب حساباً موثّقاً (المستوى 2) 📋',
      403,
      'LEVEL2_REQUIRED'
    ));
  }
  return next();
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    setAuthenticatedResponseHeaders(res);
    req.user = await resolveAccessIdentity(token);
  } catch {
    req.user = null;
  }
  return next();
};

export { ROLES };

export { getBearerToken };

export { loadAuthState };

export { resolveAccessIdentity };

export { setAuthenticatedResponseHeaders };

export default { requireAuth, requireAdmin, requireSuperAdmin, requireLevel2, optionalAuth, ROLES, getBearerToken, loadAuthState, resolveAccessIdentity, setAuthenticatedResponseHeaders };
