// utils/tokenUtils.js
// ✅ النسخة المحدثة والمحمية بالكامل بعد إزالة تشفير الهاش المحتجز داخلياً
const jwt    = require('jsonwebtoken');

// ✅ إصلاح D-02: استيراد دالة التشفير الموحدة من ملف الـ cryptoUtils المخصص لهيكل المشروع
const { hashToken } = require('./cryptoUtils');

const isProduction = process.env.NODE_ENV === 'production';

// ── ثوابت الـ Cookie ──────────────────────────────────────────
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

// ── استخرج فقط الحقول الضرورية كـ plain object ──────────────
const _extractPayload = (user) => ({
  user: {
    id:         (user._id ?? user.id)?.toString(), 
    role:       user.role,
    trustLevel: user.trustLevel ?? 1,
    isVerified: user.isVerified ?? true,
    isBanned:   user.isBanned   ?? false,
  },
});

const generateAccessToken = (user) =>
  jwt.sign(_extractPayload(user), process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m',
  });

const generateRefreshToken = (user) => {
  const token  = jwt.sign(_extractPayload(user), process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
  });
  
  // ✅ إصلاح D-02: استبدال الكود الداخلي المكرر بـ hashToken المركزية والآمنة
  const hashed = hashToken(token);
  return { token, hashed };
};

const verifyAccessToken  = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);

const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
};