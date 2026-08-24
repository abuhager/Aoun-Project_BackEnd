// utils/tokenUtils.js
// ✅ FIX [SEC-02]        : parseExpireToMs تزامن maxAge مع JWT_REFRESH_EXPIRE
// ✅ FIX [ARCH-CTRL-01]  : SESSION_ACTIVE_OPTIONS + CLEAR_SESSION_ACTIVE_OPTIONS
//                          نُقلتا من authController إلى هنا — كل Cookie logic في ملف واحد

const jwt           = require('jsonwebtoken');
const crypto        = require('crypto');
const { hashToken } = require('./cryptoUtils');
const { parseDurationMs } = require('../config/env');

const JWT_SECRET         = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_ACCESS_EXPIRE  = process.env.JWT_ACCESS_EXPIRE;
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE;
const JWT_ISSUER         = process.env.JWT_ISSUER   || 'aoun-api';
const JWT_AUDIENCE       = process.env.JWT_AUDIENCE || 'aoun-web';

if (!JWT_SECRET || !JWT_REFRESH_SECRET || !JWT_ACCESS_EXPIRE || !JWT_REFRESH_EXPIRE) {
  throw new Error(
    '[tokenUtils] متغيرات JWT مفقودة في البيئة.\n' +
    'تأكد من وجود: JWT_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRE, JWT_REFRESH_EXPIRE'
  );
}

// ✅ تحويل "7d" / "30m" / "1h" إلى milliseconds مع حد أعلى آمن للكوكي.
const parseExpireToMs = (expStr) => {
  const parsed = parseDurationMs(expStr);
  const maxRefreshMs = 90 * 24 * 60 * 60 * 1000;
  if (parsed && parsed <= maxRefreshMs) return parsed;

  console.warn(
    `[tokenUtils] قيمة JWT_REFRESH_EXPIRE غير قابلة للتحليل بأمان: "${expStr}" — سيُستخدم 7 أيام افتراضياً`
  );
  return 7 * 24 * 60 * 60 * 1000;
};

const buildCookieConfiguration = (env = process.env) => {
  const production = env.NODE_ENV === 'production';
  const refreshCookieName = production ? '__Secure-aoun_refresh' : 'refreshToken';
  const refreshMaxAge = parseExpireToMs(env.JWT_REFRESH_EXPIRE);
  const commonRefreshOptions = {
    httpOnly: true,
    secure: production,
    // كل طلبات المتصفح تمر عبر Next.js /api rewrite من نفس الموقع.
    sameSite: 'lax',
    path: '/api/auth',
    priority: 'high',
  };

  return {
    REFRESH_COOKIE_NAME: refreshCookieName,
    LEGACY_REFRESH_COOKIE_NAME: 'refreshToken',
    REFRESH_COOKIE_OPTIONS: {
      ...commonRefreshOptions,
      maxAge: refreshMaxAge,
    },
    CLEAR_REFRESH_COOKIE_OPTIONS: { ...commonRefreshOptions },
    LEGACY_CLEAR_REFRESH_COOKIE_OPTIONS: {
      httpOnly: true,
      secure: production,
      sameSite: production ? 'none' : 'lax',
      path: '/api/auth',
      priority: 'high',
    },
    SESSION_ACTIVE_OPTIONS: {
      httpOnly: false,
      secure: production,
      sameSite: 'lax',
      maxAge: refreshMaxAge,
      path: '/',
    },
    CLEAR_SESSION_ACTIVE_OPTIONS: {
      httpOnly: false,
      secure: production,
      sameSite: 'lax',
      path: '/',
    },
  };
};

const {
  REFRESH_COOKIE_NAME,
  LEGACY_REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
  LEGACY_CLEAR_REFRESH_COOKIE_OPTIONS,
  SESSION_ACTIVE_OPTIONS,
  CLEAR_SESSION_ACTIVE_OPTIONS,
} = buildCookieConfiguration();

// ── Payload ──────────────────────────────────────────────────
const _extractPayload = (user) => ({
  user: {
    id:         (user._id ?? user.id)?.toString(),
    role:       user.role,
    trustLevel: user.trustLevel ?? 1,
    isVerified: user.isVerified ?? false,
    isBanned:   user.isBanned   ?? false,
    sessionVersion: Number(user.sessionVersion ?? 0),
  },
});

const generateAccessToken = (user) =>
  jwt.sign(_extractPayload(user), JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_ACCESS_EXPIRE,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

const generateRefreshToken = (user) => {
  const token  = jwt.sign(_extractPayload(user), JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_REFRESH_EXPIRE,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: crypto.randomUUID(),
  });
  const hashed = hashToken(token);
  return { token, hashed };
};

const VERIFY_OPTIONS = {
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

const verifyAccessToken  = (token) => jwt.verify(token, JWT_SECRET, VERIFY_OPTIONS);
const verifyRefreshToken = (token) => jwt.verify(token, JWT_REFRESH_SECRET, VERIFY_OPTIONS);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_COOKIE_NAME,
  LEGACY_REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS,
  LEGACY_CLEAR_REFRESH_COOKIE_OPTIONS,
  SESSION_ACTIVE_OPTIONS,         // ✅ [ARCH-CTRL-01] مُصدَّر
  CLEAR_SESSION_ACTIVE_OPTIONS,   // ✅ [ARCH-CTRL-01] مُصدَّر
  buildCookieConfiguration,
  parseExpireToMs,
};
