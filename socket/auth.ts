import mongoose from 'mongoose';
import type { AounSocket, SocketNext, SocketOperationError } from './socketTypes.js';
import { asSocketError } from './socketTypes.js';
import { verifyAccessToken } from '../utils/tokenUtils.js';
import { resolveAccessIdentity } from '../middlewares/auth.js';

const createSocketAuthError = (
  message: string,
  code = 'SOCKET_UNAUTHORIZED'
): SocketOperationError => {
  return Object.assign(new Error(message), { data: { code } });
};

const verifySocketToken = (token: unknown): { id: string; expiresAt: number } => {
  if (!token || typeof token !== 'string') {
    throw createSocketAuthError('مطلوب تسجيل الدخول للاتصال الفوري');
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error: unknown) {
    const code = error instanceof Error && error.name === 'TokenExpiredError'
      ? 'TOKEN_EXPIRED'
      : 'SOCKET_UNAUTHORIZED';
    throw createSocketAuthError(
      code === 'TOKEN_EXPIRED'
        ? 'رمز الاتصال منتهي الصلاحية'
        : 'رمز الاتصال غير صالح',
      code
    );
  }

  const userId = decoded?.user?.id;
  if (!mongoose.isObjectIdOrHexString(userId)) {
    throw createSocketAuthError('بيانات الهوية داخل الرمز غير صالحة');
  }

  const expiresAt = Number(decoded.exp) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw createSocketAuthError('رمز الاتصال منتهي الصلاحية', 'TOKEN_EXPIRED');
  }

  return { id: String(userId), expiresAt };
};

const socketAuthMiddleware = async (socket: AounSocket, next: SocketNext) => {
  const token = socket.handshake.auth?.token;
  try {
    const verifiedToken = verifySocketToken(token);
    const identity = await resolveAccessIdentity(token);
    socket.data = {
      ...socket.data,
      userId: identity.id,
      userName: identity.name,
      userRole: identity.role,
      tokenExpiresAt: verifiedToken.expiresAt,
    };
    return next();
  } catch (error: unknown) {
    const socketError = asSocketError(error);
    const code = socketError.code || socketError.data?.code || 'SOCKET_UNAUTHORIZED';
    const isSafeClientError = Number.isInteger(socketError.statusCode)
      ? Number(socketError.statusCode) < 500
      : Boolean(socketError.data?.code);
    return next(createSocketAuthError(
      isSafeClientError ? socketError.message : 'تعذر التحقق من هوية الاتصال',
      code
    ));
  }
};

export { createSocketAuthError, socketAuthMiddleware, verifySocketToken };
export default {
  createSocketAuthError,
  socketAuthMiddleware,
  verifySocketToken,
};
