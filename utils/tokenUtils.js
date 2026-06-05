// utils/tokenUtils.js
const jwt = require('jsonwebtoken');

const generateAccessToken = (user, shortLived = false) => {
  return jwt.sign(
    {
      user: {
        id:         user._id?.toString?.() || user.id,
        role:       user.role,
        trustLevel: user.trustLevel ?? 1,
        isBanned:   user.isBanned   ?? false,
      },
    },
    process.env.JWT_SECRET,
    { expiresIn: shortLived ? '5m' : '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { user: { id: user._id?.toString?.() || user.id } },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

const verifyAccessToken  = (token) => jwt.verify(token, process.env.JWT_SECRET);
const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const isProduction = process.env.NODE_ENV === 'production';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',          // ✅ الإصلاح الجذري — كان '/api/auth'
                          // middleware.ts يقرأ الـ cookie على مسارات مثل /dashboard
                          // المتصفح لا يُرسل cookie بـ path='/api/auth' إلا لطلبات /api/auth
                          // النتيجة السابقة: hasSession = false دائماً → redirect للـ login
  maxAge:   7 * 24 * 60 * 60 * 1000,
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_COOKIE_OPTIONS,
};