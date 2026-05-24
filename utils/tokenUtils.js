// utils/tokenUtils.js
// ✅ Phase 1 Fix:
//    - أضيف trustLevel للـ Access Token payload (يحل Bug #7 جزئياً)
//    - أضيف isBanned للـ Access Token payload (يُغني auth middleware عن DB query)
//    - الـ API لم يتغير — نفس exports

const jwt = require('jsonwebtoken');

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      user: {
        id:         user._id?.toString?.() || user.id,
        role:       user.role,
        // ✅ Fix Bug #7 جزئياً — أضف trustLevel و isBanned للـ payload
        // بدل DB query في كل طلب
        trustLevel: user.trustLevel ?? 1,
        isBanned:   user.isBanned   ?? false,
      },
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { user: { id: user._id?.toString?.() || user.id } },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

const isProduction = process.env.NODE_ENV === 'production';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/',
};

const CLEAR_REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',
};

const verifyAccessToken  = (token) => jwt.verify(token, process.env.JWT_SECRET);
const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
};