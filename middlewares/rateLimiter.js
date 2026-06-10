// middlewares/rateLimiter.js
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';
const devMultiplier = isDev ? 20 : 1;

// ── حد عام على كل الـ routes ─────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'طلبات كثيرة جداً، حاول لاحقاً 🚦' },
});

// ── تسجيل الدخول ──────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10 * devMultiplier,
  keyGenerator: (req, res) => {
    const email = (req.body?.email ?? '').toLowerCase().trim();
    // نستخدم ipKeyGenerator للحصول على الـ IP المتوافق مع IPv6 بشكل آمن
    return `${ipKeyGenerator(req, res)}_${email}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'محاولات تسجيل دخول كثيرة، انتظر 15 دقيقة 🔒' },
});

// ── إرسال OTP ─────────────────────────────────────────────────
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5 * devMultiplier,
  keyGenerator: (req, res) => {
    const identifier = (req.body?.email ?? req.body?.phone ?? req.body?.identifier ?? '').toLowerCase().trim();
    return `${ipKeyGenerator(req, res)}_${identifier}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'حاولت كثيراً، انتظر 10 دقائق ⏳', code: 'OTP_RATE_LIMIT' },
});

// ── نسيان كلمة المرور ─────────────────────────────────────────
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3 * devMultiplier,
  keyGenerator: (req, res) => {
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return `${ipKeyGenerator(req, res)}_${email}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'طلبات كثيرة لاستعادة كلمة المرور، انتظر ساعة' },
});

// ── التسجيل ────────────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5 * devMultiplier,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'تسجيلات كثيرة من نفس الـ IP' },
});

module.exports = {
  globalLimiter,
  loginLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  registerLimiter,
};