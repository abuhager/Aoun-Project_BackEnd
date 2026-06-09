// middlewares/rateLimiter.js
// ✅ إصلاح #8 — إزالة skip الكامل في dev، قيم مخففة بدلاً منه
const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// مضاعف للتطوير — يرفع الـ limits بدلاً من تجاهلها كلياً
const devMultiplier = isDev ? 20 : 1;

// ── حد عام على كل الـ routes ─────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,             // 15 دقيقة
  max:      150 * devMultiplier,         // 150 prod / 3000 dev
  standardHeaders: true,
  legacyHeaders:   false,
  message: { msg: 'طلبات كثيرة جداً، حاول لاحقاً 🚦' },
});

// ── تسجيل الدخول ──────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10 * devMultiplier,          // 10 prod / 200 dev
  standardHeaders: true,
  legacyHeaders:   false,
  message: { msg: 'محاولات تسجيل دخول كثيرة، انتظر 15 دقيقة 🔒' },
});

// ── إرسال OTP ─────────────────────────────────────────────────
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      5 * devMultiplier,           // 5 prod / 100 dev
  standardHeaders: true,
  legacyHeaders:   false,
  message: { msg: 'حاولت كثيراً، انتظر 10 دقائق ⏳', code: 'OTP_RATE_LIMIT' },
});

// ── نسيان كلمة المرور ─────────────────────────────────────────
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,             // ساعة كاملة
  max:      3 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { msg: 'طلبات كثيرة لاستعادة كلمة المرور، انتظر ساعة' },
});

// ── التسجيل ────────────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      5 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { msg: 'تسجيلات كثيرة من نفس الـ IP' },
});

module.exports = {
  globalLimiter,
  loginLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  registerLimiter,
};