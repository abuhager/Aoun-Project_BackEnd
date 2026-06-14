// utils/tokenUtils.js — النسخة المصحّحة (Flow-1 Audit)
// ✅ إصلاح BUG-03: JWT expire يُرمى error صريح عند startup إذا كانت القيم مفقودة
//    (الفحص الفعلي يحدث في server.js — هنا نضيف guard ثانوي للأمان)

const jwt          = require('jsonwebtoken');
const { hashToken } = require('./cryptoUtils');

const isProduction = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────
// ✅ BUG-03: Guard ثانوي — إذا استُدعي tokenUtils قبل فحص server.js
// (مثلاً في tests أو scripts مستقلة)
// ─────────────────────────────────────────────────────────────
const JWT_SECRET         = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_ACCESS_EXPIRE  = process.env.JWT_ACCESS_EXPIRE;
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE;

if (!JWT_SECRET || !JWT_REFRESH_SECRET || !JWT_ACCESS_EXPIRE || !JWT_REFRESH_EXPIRE) {
  throw new Error(
    '[tokenUtils] متغيرات JWT مفقودة في البيئة.\n' +
    'تأكد من وجود: JWT_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRE, JWT_REFRESH_EXPIRE'
  );
}

// ── ثوابت الـ Cookie ──────────────────────────────────────────
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 أيام بالـ milliseconds
  path:     '/',
};

const CLEAR_REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',
};

// ── استخرج فقط الحقول الضرورية كـ plain object ──────────────
// لا نضع كل الـ user document في الـ JWT — فقط ما يحتاجه الـ middleware
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
  jwt.sign(_extractPayload(user), JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRE,
  });

const generateRefreshToken = (user) => {
  const token  = jwt.sign(_extractPayload(user), JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRE,
  });
  const hashed = hashToken(token); // SHA-256 قبل التخزين في DB
  return { token, hashed };
};

const verifyAccessToken  = (token) => jwt.verify(token, JWT_SECRET);
const verifyRefreshToken = (token) => jwt.verify(token, JWT_REFRESH_SECRET);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
};
