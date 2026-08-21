const mongoose = require('mongoose');

const { verifyAccessToken } = require('../utils/tokenUtils');
const { resolveAccessIdentity } = require('../middlewares/auth');

const createSocketAuthError = (message, code = 'SOCKET_UNAUTHORIZED') => {
  const error = new Error(message);
  error.data = { code };
  return error;
};

const verifySocketToken = (token) => {
  if (!token || typeof token !== 'string') {
    throw createSocketAuthError('مطلوب تسجيل الدخول للاتصال الفوري');
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw createSocketAuthError('رمز الاتصال غير صالح أو منتهي الصلاحية');
  }

  const userId = decoded?.user?.id;
  if (!mongoose.isObjectIdOrHexString(userId)) {
    throw createSocketAuthError('بيانات الهوية داخل الرمز غير صالحة');
  }

  return { id: String(userId) };
};

const socketAuthMiddleware = async (socket, next) => {
  const token = socket.handshake.auth?.token;
  try {
    verifySocketToken(token);
    const identity = await resolveAccessIdentity(token);
    socket.userId = identity.id;
    socket.userName = identity.name;
    socket.userRole = identity.role;
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
