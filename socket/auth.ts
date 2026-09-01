const mongoose = require('mongoose');

const { verifyAccessToken } = require('../utils/tokenUtils');
const { resolveAccessIdentity } = require('../middlewares/auth');

const createSocketAuthError = (message, code = 'SOCKET_UNAUTHORIZED') => {
  return Object.assign(new Error(message), { data: { code } });
};

const verifySocketToken = (token) => {
  if (!token || typeof token !== 'string') {
    throw createSocketAuthError('مطلوب تسجيل الدخول للاتصال الفوري');
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    const code = error?.name === 'TokenExpiredError'
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

const socketAuthMiddleware = async (socket, next) => {
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
  } catch (error) {
    const code = error.code || error.data?.code || 'SOCKET_UNAUTHORIZED';
    const isSafeClientError = Number.isInteger(error.statusCode)
      ? error.statusCode < 500
      : Boolean(error.data?.code);
    return next(createSocketAuthError(
      isSafeClientError ? error.message : 'تعذر التحقق من هوية الاتصال',
      code
    ));
  }
};

module.exports = {
  createSocketAuthError,
  socketAuthMiddleware,
  verifySocketToken,
};
