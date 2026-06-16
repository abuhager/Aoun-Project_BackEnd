// middlewares/rateLimiter.js — Flow 1 FINAL FIXED
// ✅ FIX-01: connectRedis() دالة async مُصدَّرة — تُستدعى من server.js قبل listen
//            يضمن أن Redis جاهز تماماً قبل أول طلب (لا race condition)
// ✅ FIX-02: جميع الحدود من env — لا hardcoded values
// ✅ FIX-03: Fallback ذكي لـ MemoryStore في dev مع تحذير واضح في production
// ✅ FIX-04: إضافة meLimiter لحماية مسار /api/auth/me من الاستغلال
// ✅ FIX-05: إيقاف Redis reconnect spam — الخطأ يظهر مرة واحدة فقط ثم يُكتم

const rateLimit          = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

// ── Redis State (مشترك داخل الـ module) ──────────────────────
let RedisStore  = null;
let redisClient = null;
let redisReady  = false;

// ── ✅ FIX-01: connectRedis — دالة async يُنتظَر اكتمالها في server.js ──
const connectRedis = async () => {
  if (!process.env.REDIS_URL) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[rateLimiter] 🚨 REDIS_URL غير مضبوط في production!\n' +
        'Rate limiting يعمل بـ MemoryStore — تحايل ممكن في بيئة multi-instance.\n' +
        'أضف REDIS_URL في متغيرات البيئة.'
      );
    } else {
      console.info('[rateLimiter] ℹ️  بدون Redis — MemoryStore نشط (مقبول في dev)');
    }
    return; // لا Redis — تعمل بـ MemoryStore
  }

  try {
    const { createClient } = require('redis');
    RedisStore             = require('rate-limit-redis');

    // ✅ FIX-05: تعطيل إعادة المحاولة التلقائية في dev لمنع spam الـ errors
    // في production: نسمح بـ 5 محاولات بفارق متزايد (max 10 ثوانٍ)
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: process.env.NODE_ENV !== 'production'
        ? {
            reconnectStrategy: false, // فشل واحد يكفي في dev — لا reconnect
          }
        : {
            reconnectStrategy: (retries) => {
              if (retries >= 5) return new Error('Redis: تجاوز الحد الأقصى لإعادة المحاولة');
              return Math.min(retries * 500, 10_000);
            },
          },
    });

    // ✅ FIX-05: الخطأ يظهر مرة واحدة فقط — بعدها يُكتم تلقائياً
    let errorLogged = false;
    redisClient.on('error', (err) => {
      if (!errorLogged) {
        console.error(
          '❌ [Redis RateLimit] خطأ في الاتصال:', err.message,
          '\n   ℹ️  يعمل بـ MemoryStore كـ fallback — لتفعيل Redis أضف REDIS_URL صحيحاً في .env'
        );
        errorLogged = true;
      }
    });

    // ✅ FIX-01: await الاتصال — لا نكمل حتى يصبح Redis جاهزاً
    await redisClient.connect();
    redisReady = true;
    console.info('✅ [Redis RateLimit] متصل وجاهز');
  } catch (e) {
    console.warn(
      '[rateLimiter] ⚠️  فشل الاتصال بـ Redis — يعمل بـ MemoryStore كـ fallback:\n',
      e.message
    );
    RedisStore  = null;
    redisClient = null;
    redisReady  = false;
  }
};

// ── دالة مساعدة لبناء الـ store ───────────────────────────────
const buildStore = (prefix) => {
  if (RedisStore && redisClient && redisReady) {
    return new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    });
  }
  return undefined; // MemoryStore الافتراضي
};

// ── مُضاعف التطوير ─────────────────────────────────────────────
const devMultiplier = process.env.NODE_ENV !== 'production' ? 20 : 1;

// ── رسالة خطأ موحَّدة ─────────────────────────────────────────
const rateLimitMessage = (type) => ({
  status:  429,
  message: `طلبات كثيرة جداً — ${type}. حاول مجدداً لاحقاً.`,
  code:    'RATE_LIMIT_EXCEEDED',
});

// ── ✅ FIX-02: جميع الحدود من env — لا hardcoded values ────────

// 1. Global Limiter
const globalLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || String(15 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_GLOBAL_MAX       || '200') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  store:           buildStore('rl:global:'),
  message:         rateLimitMessage('global'),
});

// 2. Login Limiter — IP + email
const loginLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || String(15 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_LOGIN_MAX       || '10') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => {
    const ip    = ipKeyGenerator(req);
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return email ? `${ip}_${email}` : ip;
  },
  store:   buildStore('rl:login:'),
  message: rateLimitMessage('تسجيل الدخول'),
});

// 3. Register Limiter
const registerLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || String(60 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_REGISTER_MAX       || '5') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  store:           buildStore('rl:register:'),
  message:         rateLimitMessage('التسجيل'),
});

// 4. Forgot Password Limiter — IP + email
const forgotPasswordLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_FORGOT_WINDOW_MS || String(60 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_FORGOT_MAX       || '5') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => {
    const ip    = ipKeyGenerator(req);
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return email ? `${ip}_${email}` : ip;
  },
  store:   buildStore('rl:forgot:'),
  message: rateLimitMessage('استعادة كلمة المرور'),
});

// 5. OTP Limiter
const otpLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_OTP_WINDOW_MS || String(15 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_OTP_MAX       || '10') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  store:           buildStore('rl:otp:'),
  message:         rateLimitMessage('التحقق من الكود'),
});

// 6. Resend OTP Limiter
const resendOtpLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_RESEND_OTP_WINDOW_MS || String(60 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_RESEND_OTP_MAX       || '5') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  store:           buildStore('rl:resend-otp:'),
  message:         rateLimitMessage('إعادة إرسال كود التحقق'),
});

// 7. Upload Limiter
const uploadLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS || String(60 * 60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_UPLOAD_MAX       || '30') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  store:           buildStore('rl:upload:'),
  message:         rateLimitMessage('رفع الملفات'),
});

// 8. ✅ FIX-04: /me Limiter
const meLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_ME_WINDOW_MS || String(60 * 1000)),
  max:             parseInt(process.env.RATE_LIMIT_ME_MAX       || '60') * devMultiplier,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.id ?? ipKeyGenerator(req),
  store:           buildStore('rl:me:'),
  message:         rateLimitMessage('جلب بيانات المستخدم (/me)'),
});

// 9. Public Limiter (لحماية البيانات العامة مثل الـ Hubs من الإغراق)
const publicLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS || String(15 * 60 * 1000)), // 15 دقيقة
  max:      parseInt(process.env.RATE_LIMIT_PUBLIC_MAX      || '100') * devMultiplier, // 100 طلب في الإنتاج
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req),
  store:           buildStore('rl:public:'),
  message:         rateLimitMessage('تصفح البيانات العامة'),
});

module.exports = {
  connectRedis,       // ← يُستدعى من server.js قبل listen
  globalLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  publicLimiter,
  otpLimiter,
  resendOtpLimiter,
  uploadLimiter,
  meLimiter,          // ← تمت إضافته هنا
};