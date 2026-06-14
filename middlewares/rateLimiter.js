// middlewares/rateLimiter.js
// ✅ FIX [ARCH-01]: نقل resendOtpLimiter إلى هنا من routes/auth.js
//    الآن كل limiters في مكان واحد مع ضبط من env

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ─────────────────────────────────────────────────────────────
// ثوابت الـ Windows الزمنية — مرجع واحد لا يتكرر
// ─────────────────────────────────────────────────────────────
const WINDOW = {
  MINUTES_10: 10 * 60 * 1000,
  MINUTES_15: 15 * 60 * 1000,
  HOUR_1:     60 * 60 * 1000,
};

// ─────────────────────────────────────────────────────────────
// حدود قابلة للضبط من env بدون إعادة deploy
// ─────────────────────────────────────────────────────────────
const LIMITS = {
  global:         parseInt(process.env.RATE_LIMIT_GLOBAL         || '150'),
  login:          parseInt(process.env.RATE_LIMIT_LOGIN          || '10'),
  otp:            parseInt(process.env.RATE_LIMIT_OTP            || '5'),
  forgotPassword: parseInt(process.env.RATE_LIMIT_FORGOT_PW      || '3'),
  register:       parseInt(process.env.RATE_LIMIT_REGISTER       || '5'),
  resendOtp:      parseInt(process.env.RATE_LIMIT_RESEND_OTP     || '3'), // ✅ FIX [ARCH-01]
};

const isDev         = process.env.NODE_ENV !== 'production';
const devMultiplier = isDev ? 20 : 1;

// ─────────────────────────────────────────────────────────────
// TODO-PROD: ربط Redis Store قبل نشر multi-instance
// npm install rate-limit-redis ioredis
// ─────────────────────────────────────────────────────────────

// ── حد عام على كل الـ routes ──────────────────────────────────
const globalLimiter = rateLimit({
  windowMs:        WINDOW.MINUTES_15,
  max:             LIMITS.global * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { msg: 'طلبات كثيرة جداً، حاول لاحقاً 🚦', code: 'RATE_LIMIT_GLOBAL' },
});

// ── تسجيل الدخول ───────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs:        WINDOW.MINUTES_15,
  max:             LIMITS.login * devMultiplier,
  keyGenerator:    (req, res) => {
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return `${ipKeyGenerator(req, res)}_${email}`;
  },
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { msg: 'محاولات تسجيل دخول كثيرة، انتظر 15 دقيقة 🔒', code: 'RATE_LIMIT_LOGIN' },
});

// ── إرسال OTP ──────────────────────────────────────────────────
const otpLimiter = rateLimit({
  windowMs:        WINDOW.MINUTES_10,
  max:             LIMITS.otp * devMultiplier,
  keyGenerator:    (req, res) => {
    const identifier = (
      req.body?.email      ??
      req.body?.phone      ??
      req.body?.identifier ??
      ''
    ).toLowerCase().trim();
    return `${ipKeyGenerator(req, res)}_${identifier}`;
  },
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { msg: 'حاولت كثيراً، انتظر 10 دقائق ⏳', code: 'OTP_RATE_LIMIT' },
});

// ── ✅ FIX [ARCH-01]: resendOtpLimiter مُنقول من routes/auth.js ──
// مُخصَّص لـ /resend-otp بـ حد أصغر ومربوط بـ env
const resendOtpLimiter = rateLimit({
  windowMs:        WINDOW.MINUTES_10,
  max:             LIMITS.resendOtp * devMultiplier,
  keyGenerator:    (req, res) => {
    // مفتاح مركّب: IP + email للحماية من Email Bombing
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return `resend_${ipKeyGenerator(req, res)}_${email}`;
  },
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { msg: 'تجاوزت الحد المسموح لإعادة الإرسال، انتظر 10 دقائق ⛔', code: 'RESEND_RATE_LIMITED' },
});

// ── نسيان كلمة المرور ──────────────────────────────────────────
const forgotPasswordLimiter = rateLimit({
  windowMs:        WINDOW.HOUR_1,
  max:             LIMITS.forgotPassword * devMultiplier,
  keyGenerator:    (req, res) => {
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return `${ipKeyGenerator(req, res)}_${email}`;
  },
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { msg: 'طلبات كثيرة لاستعادة كلمة المرور، انتظر ساعة', code: 'RATE_LIMIT_FORGOT_PW' },
});

// ── التسجيل ────────────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs:        WINDOW.HOUR_1,
  max:             LIMITS.register * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { msg: 'تسجيلات كثيرة من نفس الـ IP', code: 'RATE_LIMIT_REGISTER' },
});

module.exports = {
  globalLimiter,
  loginLimiter,
  otpLimiter,
  resendOtpLimiter,           // ✅ FIX [ARCH-01]
  forgotPasswordLimiter,
  registerLimiter,
};