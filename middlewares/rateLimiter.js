const { createHash } = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

const { parsePositiveInteger } = require('../config/env');

let redisClient = null;
let redisReady = false;
let limiterInstances = {};

const definitions = {
  globalLimiter: ['RATE_LIMIT_GLOBAL', 15 * 60 * 1000, 200, 'rl:global:', 'global'],
  loginLimiter: ['RATE_LIMIT_LOGIN', 15 * 60 * 1000, 10, 'rl:login:', 'تسجيل الدخول', 'email'],
  registerLimiter: ['RATE_LIMIT_REGISTER', 60 * 60 * 1000, 5, 'rl:register:', 'التسجيل'],
  forgotPasswordLimiter: ['RATE_LIMIT_FORGOT', 60 * 60 * 1000, 5, 'rl:forgot:', 'استعادة كلمة المرور', 'email'],
  otpLimiter: ['RATE_LIMIT_OTP', 15 * 60 * 1000, 10, 'rl:otp:', 'التحقق من الكود'],
  resendOtpLimiter: ['RATE_LIMIT_RESEND_OTP', 60 * 60 * 1000, 5, 'rl:resend-otp:', 'إعادة إرسال كود التحقق'],
  uploadLimiter: ['RATE_LIMIT_UPLOAD', 60 * 60 * 1000, 30, 'rl:upload:', 'رفع الملفات'],
  meLimiter: ['RATE_LIMIT_ME', 60 * 1000, 60, 'rl:me:', 'جلب بيانات المستخدم'],
  publicLimiter: ['RATE_LIMIT_PUBLIC', 15 * 60 * 1000, 100, 'rl:public:', 'تصفح البيانات العامة'],
};

const buildStore = (prefix) => {
  if (!redisReady || !redisClient) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
};

const emailKeyGenerator = (req) => {
  const ip = ipKeyGenerator(req.ip);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) return ip;
  const digest = createHash('sha256').update(email).digest('hex').slice(0, 24);
  return `${ip}:${digest}`;
};

const createLimiter = (definition) => {
  const [envPrefix, defaultWindowMs, defaultMax, storePrefix, messageType, keyType] = definition;
  const developmentMultiplier = process.env.NODE_ENV === 'production' ? 1 : 20;
  const windowMs = parsePositiveInteger(
    process.env[`${envPrefix}_WINDOW_MS`],
    defaultWindowMs,
    { max: 7 * 24 * 60 * 60 * 1000 }
  );
  const configuredMax = parsePositiveInteger(
    process.env[`${envPrefix}_MAX`],
    defaultMax,
    { max: 100_000 }
  );

  return rateLimit({
    windowMs,
    limit: configuredMax * developmentMultiplier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyType === 'email' ? emailKeyGenerator : undefined,
    store: buildStore(storePrefix),
    message: {
      status: 429,
      message: `طلبات كثيرة جداً — ${messageType}. حاول مجدداً لاحقاً.`,
      code: 'RATE_LIMIT_EXCEEDED',
    },
  });
};

const rebuildLimiters = () => {
  limiterInstances = Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [name, createLimiter(definition)])
  );
};

const delegate = (name) => (req, res, next) => limiterInstances[name](req, res, next);

rebuildLimiters();

const connectRedis = async () => {
  if (!process.env.REDIS_URL) {
    redisReady = false;
    rebuildLimiters();
    const message = '[rateLimiter] REDIS_URL غير مضبوط؛ MemoryStore يعمل لهذه النسخة فقط.';
    if (process.env.NODE_ENV === 'production') console.warn(message);
    else console.info(message);
    return false;
  }

  if (redisClient?.isReady) return true;

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: parsePositiveInteger(process.env.REDIS_CONNECT_TIMEOUT_MS, 5_000),
        reconnectStrategy: (retries) => {
          if (retries >= 5) return new Error('Redis: تجاوز الحد الأقصى لإعادة الاتصال');
          return Math.min(250 * 2 ** retries, 5_000);
        },
      },
    });

    let errorLogged = false;
    redisClient.on('error', (error) => {
      if (!errorLogged) {
        console.error('[Redis RateLimit] تعذر استخدام Redis:', error.message);
        errorLogged = true;
      }
    });
    redisClient.on('reconnecting', () => {
      if (!redisReady) return;
      redisReady = false;
      rebuildLimiters();
    });
    redisClient.on('ready', () => {
      if (redisReady) return;
      redisReady = true;
      rebuildLimiters();
    });

    await redisClient.connect();
    redisReady = true;
    rebuildLimiters();
    console.info('[Redis RateLimit] متصل وجاهز');
    return true;
  } catch (error) {
    redisReady = false;
    rebuildLimiters();
    const failedClient = redisClient;
    redisClient = null;
    if (failedClient?.isOpen) await failedClient.disconnect();
    if (process.env.REDIS_REQUIRED === 'true') throw error;
    console.warn('[rateLimiter] فشل Redis؛ تم الرجوع إلى MemoryStore:', error.message);
    return false;
  }
};

const closeRedis = async () => {
  redisReady = false;
  rebuildLimiters();
  if (!redisClient?.isOpen) {
    redisClient = null;
    return;
  }
  const client = redisClient;
  redisClient = null;
  await client.quit();
};

const getRateLimiterStatus = () => ({
  store: redisReady ? 'redis' : 'memory',
  redisConfigured: Boolean(process.env.REDIS_URL),
  redisReady,
});

module.exports = {
  connectRedis,
  closeRedis,
  getRateLimiterStatus,
  globalLimiter: delegate('globalLimiter'),
  loginLimiter: delegate('loginLimiter'),
  registerLimiter: delegate('registerLimiter'),
  forgotPasswordLimiter: delegate('forgotPasswordLimiter'),
  publicLimiter: delegate('publicLimiter'),
  otpLimiter: delegate('otpLimiter'),
  resendOtpLimiter: delegate('resendOtpLimiter'),
  uploadLimiter: delegate('uploadLimiter'),
  meLimiter: delegate('meLimiter'),
};
