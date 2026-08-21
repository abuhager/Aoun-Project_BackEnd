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

const parsePositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const validateEnvironment = (env = process.env) => {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  const errors = [];

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
      parseAllowedOrigins(env.ALLOWED_ORIGINS);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (env.NODE_ENV === 'production') {
    if ((env.JWT_SECRET?.length ?? 0) < 32) {
      errors.push('JWT_SECRET يجب ألا يقل عن 32 محرفاً في production');
    }
    if ((env.JWT_REFRESH_SECRET?.length ?? 0) < 32) {
      errors.push('JWT_REFRESH_SECRET يجب ألا يقل عن 32 محرفاً في production');
    }
    if ((env.COOKIE_SECRET?.length ?? 0) < 32) {
      errors.push('COOKIE_SECRET يجب ألا يقل عن 32 محرفاً في production');
    }
    if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      errors.push('JWT_SECRET و JWT_REFRESH_SECRET يجب أن يكونا مختلفين');
    }
  }

  if (errors.length) {
    const error = new Error(`[Startup] فشل التحقق من البيئة:\n- ${errors.join('\n- ')}`);
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
  parsePositiveInteger,
  validateEnvironment,
};
