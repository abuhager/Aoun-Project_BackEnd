// middlewares/rateLimiter.js
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit'); // ✅ أضف هذا

const isDev = process.env.NODE_ENV !== 'production';

// 🛡️ 1. Rate Limiter العام
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      isDev ? 2000 : 150,
  message:  { msg: '🛑 طلبات كثيرة جداً من جهازك، الرجاء الانتظار قليلاً.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => isDev,
});

// 🛡️ 2. Rate Limiter لمسارات auth الحساسة
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      isDev ? 1000 : 50,
  message:  { msg: '🛑 محاولات تسجيل دخول كثيرة، حسابك مقفل مؤقتاً لمدة ساعة.' },
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  skip: () => isDev,
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req), // ✅ إصلاح
});

// 🛡️ 3. Refresh limiter
const refreshLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      isDev ? 2000 : 60,
  message:  { msg: '🛑 طلبات تجديد الجلسة كثيرة جداً، حاول بعد قليل.' },
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  skip: () => isDev,
});

// 🛡️ 4. OTP Limiter
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      isDev ? 1000 : 5,
  message:  { msg: '🔐 محاولات كثيرة، انتظر 10 دقائق قبل المحاولة مجدداً.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => isDev,
});

// 🛡️ 5. Register Limiter
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      isDev ? 1000 : 20,
  message:  { msg: '🛑 محاولات إنشاء حساب كثيرة، حاول بعد ساعة.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => isDev,
});

// 🛡️ 6. Forgot Password Limiter
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      isDev ? 1000 : 10,
  message:  { msg: '🛑 محاولات كثيرة، حاول بعد ساعة.' },
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req), // ✅ إصلاح
  skip: () => isDev,
});

module.exports = {
  globalLimiter,
  authLimiter,
  refreshLimiter,
  otpLimiter,
  registerLimiter,
  forgotPasswordLimiter,
};