// utils/tokenUtils.js
// ✅ FIX [SEC-02]        : parseExpireToMs تزامن maxAge مع JWT_REFRESH_EXPIRE
// ✅ FIX [ARCH-CTRL-01]  : SESSION_ACTIVE_OPTIONS + CLEAR_SESSION_ACTIVE_OPTIONS
//                          نُقلتا من authController إلى هنا — كل Cookie logic في ملف واحد

const jwt           = require('jsonwebtoken');
const { hashToken } = require('./cryptoUtils');

const isProduction = process.env.NODE_ENV === 'production';

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

// ✅ FIX [SEC-02]: تحويل "7d" / "30m" / "1h" → milliseconds
const parseExpireToMs = (expStr) => {
  const match = String(expStr ?? '7d').match(/^(\d+)([smhd])$/);
  if (!match) {
    console.warn(`[tokenUtils] قيمة JWT_REFRESH_EXPIRE غير قابلة للتحليل: "${expStr}" — سيُستخدم 7 أيام افتراضياً`);
    return 7 * 24 * 60 * 60 * 1000;
  }
  const [, num, unit] = match;
  const unitMap = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return parseInt(num, 10) * unitMap[unit];
};

// ── Refresh Token Cookie ─────────────────────────────────────
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   parseExpireToMs(JWT_REFRESH_EXPIRE),
  path:     '/',
};

const CLEAR_REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',
};

// ✅ [ARCH-CTRL-01] session_active كوكي غير حساس يُقرأ بـ JS (httpOnly: false مقصود)
// نُقل من authController ليكون كل Cookie config في مكان واحد
const SESSION_ACTIVE_OPTIONS = {
  httpOnly: false,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   parseExpireToMs(JWT_REFRESH_EXPIRE),
  path:     '/',
};

const CLEAR_SESSION_ACTIVE_OPTIONS = {
  httpOnly: false,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',
};

// ── Payload ──────────────────────────────────────────────────
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
  jwt.sign(_extractPayload(user), JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRE });

const generateRefreshToken = (user) => {
  const token  = jwt.sign(_extractPayload(user), JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRE });
  const hashed = hashToken(token);
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
  SESSION_ACTIVE_OPTIONS,         // ✅ [ARCH-CTRL-01] مُصدَّر
  CLEAR_SESSION_ACTIVE_OPTIONS,   // ✅ [ARCH-CTRL-01] مُصدَّر
  parseExpireToMs,
};