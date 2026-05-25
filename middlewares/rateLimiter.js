// middlewares/rateLimiter.js
const rateLimit = require('express-rate-limit');

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
  max:      isDev ? 1000 : 10,
  message:  { msg: '🛑 محاولات تسجيل دخول كثيرة، حسابك مقفل مؤقتاً لمدة ساعة.' },
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  skip: () => isDev,
});

// 🛡️ 3. Refresh limiter أخف لأن refresh طبيعي يتكرر
const refreshLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      isDev ? 2000 : 60,
  message:  { msg: '🛑 طلبات تجديد الجلسة كثيرة جداً، حاول بعد قليل.' },
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  skip: () => isDev,
});

// 🛡️ 4. OTP Limiter — أشد قيوداً لمنع Brute Force على رموز التحقق  ✅ جديد
// 5 محاولات كل 10 دقائق — يحمي send-otp + verify-otp معاً
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 دقائق
  max:      isDev ? 1000 : 5, // 5 محاولات في production
  message:  { msg: '🔐 محاولات كثيرة، انتظر 10 دقائق قبل المحاولة مجدداً.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => isDev,
  // keyGenerator: يعتمد على IP (الافتراضي) + نثق بـ trust proxy من server.js
});

module.exports = { globalLimiter, authLimiter, refreshLimiter, otpLimiter }; // ✅ أضفنا otpLimiter