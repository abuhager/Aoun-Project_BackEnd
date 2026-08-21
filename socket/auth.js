const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const createSocketAuthError = (message, code = 'SOCKET_UNAUTHORIZED') => {
  const error = new Error(message);
  error.data = { code };
  return error;
};

const verifySocketToken = (token, secret = process.env.JWT_SECRET) => {
  if (!token || typeof token !== 'string') {
    throw createSocketAuthError('مطلوب تسجيل الدخول للاتصال الفوري');
  }
  if (!secret) {
    throw createSocketAuthError('تعذر تهيئة مصادقة الاتصال الفوري', 'SOCKET_AUTH_MISCONFIGURED');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    throw createSocketAuthError('رمز الاتصال غير صالح أو منتهي الصلاحية');
  }

  const user = decoded?.user;
  if (!user || !mongoose.isObjectIdOrHexString(user.id)) {
    throw createSocketAuthError('بيانات الهوية داخل الرمز غير صالحة');
  }

  return {
    id: user.id.toString(),
    name: typeof user.name === 'string' ? user.name : '',
    role: typeof user.role === 'string' ? user.role : 'user',
  };
};

const socketAuthMiddleware = (socket, next) => {
  try {
    const identity = verifySocketToken(socket.handshake.auth?.token);
    socket.userId = identity.id;
    socket.userName = identity.name;
    socket.userRole = identity.role;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSocketAuthError,
  socketAuthMiddleware,
  verifySocketToken,
};
