const parseAllowedOrigins = (value = '') => {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`[CORS] Origin غير صالح: ${origin}`);
      }

      if (
        !['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || (parsed.pathname !== '/' && parsed.pathname !== '')
        || parsed.search
        || parsed.hash
      ) {
        throw new Error(`[CORS] يجب أن يكون Origin بصيغة scheme://host فقط: ${origin}`);
      }
      return parsed.origin;
    });

  return [...new Set(origins)];
};

const getAllowedOrigins = () => parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || ''
);

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  return getAllowedOrigins().includes(origin);
};

const createCorsError = (origin) => {
  const configured = getAllowedOrigins();
  const error = new Error(
    configured.length
      ? `CORS: Origin غير مصرح به — ${origin}`
      : 'CORS: لا توجد Origins مسموح بها — اضبط ALLOWED_ORIGINS'
  );
  error.status = 403;
  error.code = configured.length ? 'CORS_ORIGIN_DENIED' : 'CORS_MISCONFIGURED';
  return error;
};

const corsOrigin = (origin, callback) => {
  try {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(createCorsError(origin));
  } catch (error) {
    error.status = 500;
    error.code = 'CORS_MISCONFIGURED';
    return callback(error);
  }
};

module.exports = {
  corsOrigin,
  createCorsError,
  getAllowedOrigins,
  isOriginAllowed,
  parseAllowedOrigins,
};
