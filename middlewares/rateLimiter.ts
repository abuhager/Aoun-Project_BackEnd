import { createHash } from 'crypto';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { parsePositiveInteger } from '../config/env.js';

type RedisClient = ReturnType<typeof createClient>;
type LimiterKeyType = 'email' | 'token' | 'user';
type LimiterDefinition = readonly [
  envPrefix: string,
  defaultWindowMs: number,
  defaultMax: number,
  storePrefix: string,
  messageType: string,
  keyType?: LimiterKeyType,
];

let redisClient: RedisClient | null = null;
let redisReady = false;

const definitions = {
  globalLimiter: ['RATE_LIMIT_GLOBAL', 15 * 60 * 1000, 200, 'rl:global:', 'global'],
  loginLimiter: ['RATE_LIMIT_LOGIN', 15 * 60 * 1000, 10, 'rl:login:', 'تسجيل الدخول', 'email'],
  registerLimiter: ['RATE_LIMIT_REGISTER', 60 * 60 * 1000, 5, 'rl:register:', 'التسجيل', 'email'],
  forgotPasswordLimiter: ['RATE_LIMIT_FORGOT', 60 * 60 * 1000, 5, 'rl:forgot:', 'استعادة كلمة المرور', 'email'],
  resetPasswordLimiter: ['RATE_LIMIT_RESET_PASSWORD', 60 * 60 * 1000, 10, 'rl:reset-password:', 'تعيين كلمة المرور', 'token'],
  refreshLimiter: ['RATE_LIMIT_REFRESH', 60 * 1000, 60, 'rl:refresh:', 'تجديد الجلسة'],
  otpLimiter: ['RATE_LIMIT_OTP', 15 * 60 * 1000, 10, 'rl:otp:', 'التحقق من الكود', 'email'],
  resendOtpLimiter: ['RATE_LIMIT_RESEND_OTP', 60 * 60 * 1000, 5, 'rl:resend-otp:', 'إعادة إرسال كود التحقق', 'email'],
  uploadLimiter: ['RATE_LIMIT_UPLOAD', 60 * 60 * 1000, 30, 'rl:upload:', 'رفع الملفات', 'user'],
  meLimiter: ['RATE_LIMIT_ME', 60 * 1000, 60, 'rl:me:', 'جلب بيانات المستخدم'],
  publicLimiter: ['RATE_LIMIT_PUBLIC', 15 * 60 * 1000, 100, 'rl:public:', 'تصفح البيانات العامة'],
  phoneVerifyLimiter: ['RATE_LIMIT_PHONE_VERIFY', 60 * 60 * 1000, 10, 'rl:phone-verify:', 'التحقق من الهاتف', 'user'],
  actionLimiter: ['RATE_LIMIT_ACTION', 60 * 1000, 30, 'rl:action:', 'تنفيذ العمليات', 'user'],
  donationActionLimiter: ['RATE_LIMIT_DONATION_ACTION', 60 * 1000, 10, 'rl:donation-action:', 'عمليات طلبات التبرع', 'user'],
} satisfies Record<string, LimiterDefinition>;

type LimiterName = keyof typeof definitions;
let limiterInstances = {} as Record<LimiterName, RateLimitRequestHandler>;

const buildStore = (prefix: string) => {
  if (!redisReady || !redisClient) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => redisClient!.sendCommand(args),
  });
};

const emailKeyGenerator = (req: Request): string => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) return ipKeyGenerator(req.ip ?? 'unknown');
  const digest = createHash('sha256').update(email).digest('hex').slice(0, 24);
  return `email:${digest}`;
};

const tokenKeyGenerator = (req: Request): string => {
  const token = String(req.body?.token ?? '').trim();
  if (!token) return ipKeyGenerator(req.ip ?? 'unknown');
  const digest = createHash('sha256').update(token).digest('hex').slice(0, 24);
  return `token:${digest}`;
};

const userKeyGenerator = (req: Request): string =>
  req.user?.id ? `user:${String(req.user.id)}` : ipKeyGenerator(req.ip ?? 'unknown');

const createLimiter = (definition: LimiterDefinition): RateLimitRequestHandler => {
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
    keyGenerator: keyType === 'email'
      ? emailKeyGenerator
      : (keyType === 'user'
          ? userKeyGenerator
          : (keyType === 'token' ? tokenKeyGenerator : undefined)),
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
  ) as Record<LimiterName, RateLimitRequestHandler>;
};

const delegate = (name: LimiterName): RequestHandler => (
  req: Request,
  res: Response,
  next: NextFunction
) => limiterInstances[name](req, res, next);

rebuildLimiters();

const connectRedis = async (): Promise<boolean> => {
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
        reconnectStrategy: (retries: number) => {
          if (retries >= 5) return new Error('Redis: تجاوز الحد الأقصى لإعادة الاتصال');
          return Math.min(250 * 2 ** retries, 5_000);
        },
      },
    });

    let errorLogged = false;
    redisClient.on('error', (error: Error) => {
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
  } catch (error: unknown) {
    redisReady = false;
    rebuildLimiters();
    const failedClient = redisClient;
    redisClient = null;
    if (failedClient?.isOpen) await failedClient.disconnect();
    if (process.env.REDIS_REQUIRED === 'true') throw error;
    console.warn(
      '[rateLimiter] فشل Redis؛ تم الرجوع إلى MemoryStore:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
};

const closeRedis = async (): Promise<void> => {
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

export const globalLimiter = delegate('globalLimiter');
export const loginLimiter = delegate('loginLimiter');
export const registerLimiter = delegate('registerLimiter');
export const forgotPasswordLimiter = delegate('forgotPasswordLimiter');
export const resetPasswordLimiter = delegate('resetPasswordLimiter');
export const refreshLimiter = delegate('refreshLimiter');
export const publicLimiter = delegate('publicLimiter');
export const phoneVerifyLimiter = delegate('phoneVerifyLimiter');
export const actionLimiter = delegate('actionLimiter');
export const donationActionLimiter = delegate('donationActionLimiter');
export const otpLimiter = delegate('otpLimiter');
export const resendOtpLimiter = delegate('resendOtpLimiter');
export const uploadLimiter = delegate('uploadLimiter');
export const meLimiter = delegate('meLimiter');

export { connectRedis, closeRedis, getRateLimiterStatus };
export default {
  connectRedis,
  closeRedis,
  getRateLimiterStatus,
  globalLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
  publicLimiter,
  phoneVerifyLimiter,
  actionLimiter,
  donationActionLimiter,
  otpLimiter,
  resendOtpLimiter,
  uploadLimiter,
  meLimiter,
  _private: {
    emailKeyGenerator,
    tokenKeyGenerator,
    userKeyGenerator,
  },
};
