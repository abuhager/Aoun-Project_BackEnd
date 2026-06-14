// utils/tokenUtils.js
// ✅ FIX [SEC-02]: إضافة parseExpireToMs لمزامنة maxAge مع JWT_REFRESH_EXPIRE من env

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

// ─────────────────────────────────────────────────────────────
// ✅ FIX [SEC-02]: تحويل قيمة مثل "7d" أو "30m" أو "1h" إلى milliseconds
// يضمن أن maxAge للـ Cookie يتزامن دائماً مع JWT_REFRESH_EXPIRE في .env
// ─────────────────────────────────────────────────────────────
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

// ── ثوابت الـ Cookie ──────────────────────────────────────────
// ✅ FIX [SEC-02]: maxAge مشتق من JWT_REFRESH_EXPIRE — لا magic numbers
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
  jwt.sign(_extractPayload(user), JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRE,
  });

const generateRefreshToken = (user) => {
  const token  = jwt.sign(_extractPayload(user), JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRE,
  });
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
  parseExpireToMs,           // ✅ FIX [SEC-02]: مُصدَّر للاستخدام في authController
};