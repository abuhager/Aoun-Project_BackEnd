// middlewares/rateLimiter.js — DRY-02 FIXED
// ✅ DRY-02: factory function createLimiter تلغي تكرار بنية الـ 9 limiters
// ✅ محافظة كاملة على كل السلوك السابق: Redis · MemoryStore · devMultiplier · env values

const rateLimit          = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

// ── Redis State ────────────────────────────────────────────────
let RedisStore  = null;
let redisClient = null;
let redisReady  = false;

// ── connectRedis ───────────────────────────────────────────────
const connectRedis = async () => {
  if (!process.env.REDIS_URL) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[rateLimiter] 🚨 REDIS_URL غير مضبوط في production!\n' +
        'Rate limiting يعمل بـ MemoryStore — تحايل ممكن في بيئة multi-instance.'
      );
    } else {
      console.info('[rateLimiter] ℹ️  بدون Redis — MemoryStore نشط (مقبول في dev)');
    }
    return;
  }

  try {
    const { createClient } = require('redis');
    RedisStore             = require('rate-limit-redis');

    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: process.env.NODE_ENV !== 'production'
        ? { reconnectStrategy: false }
        : { reconnectStrategy: (retries) => {
            if (retries >= 5) return new Error('Redis: تجاوز الحد الأقصى');
            return Math.min(retries * 500, 10_000);
          }},
    });

    let errorLogged = false;
    redisClient.on('error', (err) => {
      if (!errorLogged) {
        console.error('❌ [Redis RateLimit]:', err.message, '\n   ℹ️  Fallback → MemoryStore');
        errorLogged = true;
      }
    });

    await redisClient.connect();
    redisReady = true;
    console.info('✅ [Redis RateLimit] متصل وجاهز');
  } catch (e) {
    console.warn('[rateLimiter] ⚠️  فشل Redis — MemoryStore كـ fallback:', e.message);
    RedisStore = null; redisClient = null; redisReady = false;
  }
};

// ── Store Builder ──────────────────────────────────────────────
const buildStore = (prefix) => {
  if (RedisStore && redisClient && redisReady) {
    return new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    });
  }
  return undefined;
};

// ── مُضاعف التطوير ─────────────────────────────────────────────
const devMultiplier = process.env.NODE_ENV !== 'production' ? 20 : 1;

// ── رسالة خطأ موحَّدة ──────────────────────────────────────────
const rateLimitMessage = (type) => ({
  status:  429,
  message: `طلبات كثيرة جداً — ${type}. حاول مجدداً لاحقاً.`,
  code:    'RATE_LIMIT_EXCEEDED',
});

// ✅ DRY-02: factory function — تُنشئ limiter من config بدل تكرار نفس البنية 9 مرات
// كل limiter يختلف فقط في: windowMs · max · storePrefix · messageType · keyGenerator
const createLimiter = ({
  envPrefix,
  defaultWindowMs,
  defaultMax,
  storePrefix,
  messageType,
  keyGen,
}) =>
  rateLimit({
    windowMs:        parseInt(process.env[`${envPrefix}_WINDOW_MS`] || String(defaultWindowMs)),
    max:             parseInt(process.env[`${envPrefix}_MAX`]       || String(defaultMax)) * devMultiplier,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    keyGen ?? ((req) => ipKeyGenerator(req)),
    store:           buildStore(storePrefix),
    message:         rateLimitMessage(messageType),
  });

// ── الـ Limiters ───────────────────────────────────────────────
const globalLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_GLOBAL',
  defaultWindowMs: 15 * 60 * 1000,
  defaultMax:      200,
  storePrefix:     'rl:global:',
  messageType:     'global',
});

const loginLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_LOGIN',
  defaultWindowMs: 15 * 60 * 1000,
  defaultMax:      10,
  storePrefix:     'rl:login:',
  messageType:     'تسجيل الدخول',
  keyGen: (req) => {
    const ip    = ipKeyGenerator(req);
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return email ? `${ip}_${email}` : ip;
  },
});

const registerLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_REGISTER',
  defaultWindowMs: 60 * 60 * 1000,
  defaultMax:      5,
  storePrefix:     'rl:register:',
  messageType:     'التسجيل',
});

const forgotPasswordLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_FORGOT',
  defaultWindowMs: 60 * 60 * 1000,
  defaultMax:      5,
  storePrefix:     'rl:forgot:',
  messageType:     'استعادة كلمة المرور',
  keyGen: (req) => {
    const ip    = ipKeyGenerator(req);
    const email = (req.body?.email ?? '').toLowerCase().trim();
    return email ? `${ip}_${email}` : ip;
  },
});

const otpLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_OTP',
  defaultWindowMs: 15 * 60 * 1000,
  defaultMax:      10,
  storePrefix:     'rl:otp:',
  messageType:     'التحقق من الكود',
});

const resendOtpLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_RESEND_OTP',
  defaultWindowMs: 60 * 60 * 1000,
  defaultMax:      5,
  storePrefix:     'rl:resend-otp:',
  messageType:     'إعادة إرسال كود التحقق',
});

const uploadLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_UPLOAD',
  defaultWindowMs: 60 * 60 * 1000,
  defaultMax:      30,
  storePrefix:     'rl:upload:',
  messageType:     'رفع الملفات',
});

const meLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_ME',
  defaultWindowMs: 60 * 1000,
  defaultMax:      60,
  storePrefix:     'rl:me:',
  messageType:     'جلب بيانات المستخدم (/me)',
  keyGen:          (req) => req.user?.id ?? ipKeyGenerator(req),
});

const publicLimiter = createLimiter({
  envPrefix:       'RATE_LIMIT_PUBLIC',
  defaultWindowMs: 15 * 60 * 1000,
  defaultMax:      100,
  storePrefix:     'rl:public:',
  messageType:     'تصفح البيانات العامة',
});

module.exports = {
  connectRedis,
  globalLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  publicLimiter,
  otpLimiter,
  resendOtpLimiter,
  uploadLimiter,
  meLimiter,
};