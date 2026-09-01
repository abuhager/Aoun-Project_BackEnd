const REQUIRED_ENV = [
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRE',
  'JWT_REFRESH_EXPIRE',
  'ALLOWED_ORIGINS',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'COOKIE_SECRET',
  'NODE_ENV',
];

const { parseAllowedOrigins } = require('./cors');

const DURATION_UNITS_MS = Object.freeze({
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
});

const PLACEHOLDER_SECRET_PATTERN = /^(?:replace[-_ ]with|change[-_ ]?me|your[-_ ]|<.+>)/i;

const parsePositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const parseDurationMs = (value) => {
  const match = String(value ?? '').trim().match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const amount = Number.parseInt(match[1], 10);
  const duration = amount * DURATION_UNITS_MS[match[2].toLowerCase()];
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null;
};

const isPlaceholderSecret = (value) => PLACEHOLDER_SECRET_PATTERN.test(
  String(value ?? '').trim()
);

const validateEnvironment = (env = process.env) => {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  const errors = [];
  let allowedOrigins = [];

  if (missing.length) {
    errors.push(`متغيرات البيئة المفقودة: ${missing.join(', ')}`);
  }

  if (env.NODE_ENV && !['development', 'test', 'production'].includes(env.NODE_ENV)) {
    errors.push('NODE_ENV يجب أن تكون development أو test أو production');
  }

  if (env.MONGO_URI && !/^mongodb(?:\+srv)?:\/\//i.test(env.MONGO_URI)) {
    errors.push('MONGO_URI يجب أن يبدأ بـ mongodb:// أو mongodb+srv://');
  }

  if (
    env.PHONE_VERIFICATION_ENABLED
    && !['true', 'false'].includes(env.PHONE_VERIFICATION_ENABLED.trim().toLowerCase())
  ) {
    errors.push('PHONE_VERIFICATION_ENABLED يجب أن تكون true أو false');
  }

  if (env.ALLOWED_ORIGINS) {
    try {
      allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (env.CLIENT_URL) {
    try {
      const clientOrigins = parseAllowedOrigins(env.CLIENT_URL);
      if (clientOrigins.length !== 1) {
        errors.push('CLIENT_URL يجب أن يحتوي Origin واحداً فقط');
      } else if (
        env.NODE_ENV === 'production'
        && allowedOrigins.length
        && !allowedOrigins.includes(clientOrigins[0])
      ) {
        errors.push('CLIENT_URL يجب أن يكون ضمن ALLOWED_ORIGINS في production');
      }
    } catch (error) {
      errors.push(error.message.replace('[CORS]', '[CLIENT_URL]'));
    }
  }

  if (
    env.REDIS_REQUIRED
    && !['true', 'false'].includes(env.REDIS_REQUIRED.trim().toLowerCase())
  ) {
    errors.push('REDIS_REQUIRED يجب أن تكون true أو false');
  }
  if (env.REDIS_REQUIRED?.trim().toLowerCase() === 'true' && !env.REDIS_URL?.trim()) {
    errors.push('REDIS_URL مطلوب عندما تكون REDIS_REQUIRED=true');
  }

  if (env.BCRYPT_ROUNDS) {
    const rounds = Number.parseInt(env.BCRYPT_ROUNDS, 10);
    if (!Number.isInteger(rounds) || rounds < 10 || rounds > 14) {
      errors.push('BCRYPT_ROUNDS يجب أن تكون عدداً بين 10 و14');
    }
  }

  if (env.UPLOAD_MAX_SIZE_BYTES) {
    const uploadLimit = Number.parseInt(env.UPLOAD_MAX_SIZE_BYTES, 10);
    if (
      !Number.isInteger(uploadLimit)
      || uploadLimit < 64 * 1024
      || uploadLimit > 10 * 1024 * 1024
    ) {
      errors.push('UPLOAD_MAX_SIZE_BYTES يجب أن تكون بين 64KB و10MB');
    }
  }

  if (env.NODE_ENV === 'production') {
    if ((env.JWT_SECRET?.length ?? 0) < 32 || isPlaceholderSecret(env.JWT_SECRET)) {
      errors.push('JWT_SECRET يجب ألا يقل عن 32 محرفاً في production');
    }
    if (
      (env.JWT_REFRESH_SECRET?.length ?? 0) < 32
      || isPlaceholderSecret(env.JWT_REFRESH_SECRET)
    ) {
      errors.push('JWT_REFRESH_SECRET يجب ألا يقل عن 32 محرفاً في production');
    }
    if ((env.COOKIE_SECRET?.length ?? 0) < 32 || isPlaceholderSecret(env.COOKIE_SECRET)) {
      errors.push('COOKIE_SECRET يجب ألا يقل عن 32 محرفاً في production');
    }
    if (
      env.OTP_PEPPER
      && ((env.OTP_PEPPER.length < 32) || isPlaceholderSecret(env.OTP_PEPPER))
    ) {
      errors.push('OTP_PEPPER يجب ألا يقل عن 32 محرفاً وألا يكون قيمة تجريبية');
    }

    const secrets = [env.JWT_SECRET, env.JWT_REFRESH_SECRET, env.COOKIE_SECRET].filter(Boolean);
    if (new Set(secrets).size !== secrets.length) {
      errors.push('JWT_SECRET وJWT_REFRESH_SECRET وCOOKIE_SECRET يجب أن تكون مختلفة');
    }

    const accessDuration = parseDurationMs(env.JWT_ACCESS_EXPIRE);
    const refreshDuration = parseDurationMs(env.JWT_REFRESH_EXPIRE);
    if (!accessDuration || accessDuration < 60_000 || accessDuration > 60 * 60 * 1000) {
      errors.push('JWT_ACCESS_EXPIRE يجب أن تكون بين دقيقة وساعة في production');
    }
    if (
      !refreshDuration
      || refreshDuration < 60 * 60 * 1000
      || refreshDuration > 90 * 24 * 60 * 60 * 1000
    ) {
      errors.push('JWT_REFRESH_EXPIRE يجب أن تكون بين ساعة و90 يوماً في production');
    }
    if (accessDuration && refreshDuration && accessDuration >= refreshDuration) {
      errors.push('JWT_ACCESS_EXPIRE يجب أن تكون أقصر من JWT_REFRESH_EXPIRE');
    }

    if (allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
      errors.push('كل ALLOWED_ORIGINS يجب أن تستخدم HTTPS في production');
    }

    const mongoUri = env.MONGO_URI ?? '';
    const isSrv = /^mongodb\+srv:\/\//i.test(mongoUri);
    const isLocal = /^mongodb:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(mongoUri);
    const hasTls = /[?&](?:tls|ssl)=true(?:&|$)/i.test(mongoUri);
    if (mongoUri && !isSrv && !isLocal && !hasTls) {
      errors.push('MONGO_URI الخارجي يجب أن يفعّل TLS/SSL في production');
    }
  }

  if (errors.length) {
    const error = new Error(
      `[Startup] فشل التحقق من البيئة:\n- ${errors.join('\n- ')}`
    ) as Error & { code?: string };
    error.code = 'INVALID_ENVIRONMENT';
    throw error;
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: parsePositiveInteger(env.PORT, 5000, { max: 65_535 }),
  };
};

module.exports = {
  REQUIRED_ENV,
  isPlaceholderSecret,
  parseDurationMs,
  parsePositiveInteger,
  validateEnvironment,
};
