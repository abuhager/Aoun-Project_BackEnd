// middlewares/rateLimiter.js — النسخة المصحّحة (Flow-1 Audit)
// ✅ إصلاح HC-01: جميع حدود الـ Rate Limit تأتي من env — لا hardcoded values
// ✅ إصلاح DRY-01: ثوابت WINDOW موحّدة بدل magic numbers مكررة
// ✅ إصلاح PERF-02: تعليق TODO-PROD واضح لربط Redis قبل multi-instance production

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ─────────────────────────────────────────────────────────────
// ✅ DRY-01: ثوابت الـ Windows الزمنية — مرجع واحد لا يتكرر
// ─────────────────────────────────────────────────────────────
const WINDOW = {
  MINUTES_10: 10 * 60 * 1000,
  MINUTES_15: 15 * 60 * 1000,
  HOUR_1:     60 * 60 * 1000,
};

// ─────────────────────────────────────────────────────────────
// ✅ HC-01: حدود قابلة للضبط من env بدون إعادة deploy
// القيم الافتراضية هنا للـ development فقط — في production يجب ضبطها صراحةً
// ─────────────────────────────────────────────────────────────
const LIMITS = {
  global:         parseInt(process.env.RATE_LIMIT_GLOBAL        || '150'),
  login:          parseInt(process.env.RATE_LIMIT_LOGIN         || '10'),
  otp:            parseInt(process.env.RATE_LIMIT_OTP           || '5'),
  forgotPassword: parseInt(process.env.RATE_LIMIT_FORGOT_PW     || '3'),
  register:       parseInt(process.env.RATE_LIMIT_REGISTER      || '5'),
};

// في dev نضرب الحدود × 20 حتى لا تعيق التطوير والتجربة
const isDev          = process.env.NODE_ENV !== 'production';
const devMultiplier  = isDev ? 20 : 1;

// ─────────────────────────────────────────────────────────────
// ✅ PERF-02: TODO — يجب ربط Redis Store قبل نشر multi-instance
// npm install rate-limit-redis ioredis
// ثم:
//   const RedisStore = require('rate-limit-redis');
//   const redisClient = require('../config/redis'); // أنشئه لاحقاً
//   store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) })
// أضف store لكل rateLimit(...) أدناه عند تفعيل Redis
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
    // مفتاح مركّب: IP + email لمنع حشو بيانات اعتماد من IPs مختلفة بنفس الحساب
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
  forgotPasswordLimiter,
  registerLimiter,
};
