// middlewares/rateLimiter.js — النسخة النهائية المصحَّحة
// ✅ ERR_ERL_KEY_GEN_IPV6: استخدام ipKeyGenerator من express-rate-limit مباشرةً
// ✅ إضافة otpLimiter و resendOtpLimiter المطلوبَين في routes/auth.js

const rateLimit = require('express-rate-limit');

// ✅ الحل الصحيح لـ ERR_ERL_KEY_GEN_IPV6:
// ipKeyGenerator مُصدَّر من express-rate-limit نفسه — يتعامل مع IPv6 بشكل صحيح
const { ipKeyGenerator } = rateLimit;

// ── مُضاعف التطوير (x20) ──────────────────────────────────────
const devMultiplier = process.env.NODE_ENV !== 'production' ? 20 : 1;

// ── رسالة خطأ موحَّدة ────────────────────────────────────────
const rateLimitMessage = (type) => ({
  status:  429,
  message: `طلبات كثيرة جداً — ${type}. حاول مجدداً لاحقاً.`,
  code:    'RATE_LIMIT_EXCEEDED',
});

// ─────────────────────────────────────────────────────────────
// 1. Global Limiter
// ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  // ✅ ipKeyGenerator من المكتبة مباشرةً — لا مشكلة IPv6
  keyGenerator:    (req) => ipKeyGenerator(req),
  message:         rateLimitMessage('global'),
});

// ─────────────────────────────────────────────────────────────
// 2. Login Limiter — IP + email
// ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  // ✅ ipKeyGenerator يُعطي IP موحَّد (IPv4 + IPv6) — ندمجه مع email
  keyGenerator: (req) => {
    const ip    = ipKeyGenerator(req);
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return email ? `${ip}_${email}` : ip;
  },
  message: rateLimitMessage('تسجيل الدخول'),
});

// ─────────────────────────────────────────────────────────────
// 3. Register Limiter
// ─────────────────────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  message:         rateLimitMessage('التسجيل'),
});

// ─────────────────────────────────────────────────────────────
// 4. Forgot Password Limiter — IP + email
// ─────────────────────────────────────────────────────────────
const forgotPasswordLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => {
    const ip    = ipKeyGenerator(req);
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return email ? `${ip}_${email}` : ip;
  },
  message: rateLimitMessage('استعادة كلمة المرور'),
});

// ─────────────────────────────────────────────────────────────
// 5. OTP Limiter — للتحقق من الكود
// ─────────────────────────────────────────────────────────────
const otpLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  message:         rateLimitMessage('التحقق من الكود'),
});

// ─────────────────────────────────────────────────────────────
// 6. Resend OTP Limiter — لإعادة إرسال كود التحقق
// ─────────────────────────────────────────────────────────────
const resendOtpLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,              // ساعة كاملة
  max:             5 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  message:         rateLimitMessage('إعادة إرسال كود التحقق'),
});

// ─────────────────────────────────────────────────────────────
// 7. Upload Limiter
// ─────────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             30 * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  message:         rateLimitMessage('رفع الملفات'),
});

module.exports = {
  globalLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  otpLimiter,
  resendOtpLimiter,   // ← كان ناقصاً — سبب TypeError في auth.js
  uploadLimiter,
};