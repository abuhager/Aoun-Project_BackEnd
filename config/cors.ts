type CorsCallback = (error: Error | null, allow?: boolean) => void;

type CorsError = Error & {
  status: number;
  code: 'CORS_ORIGIN_DENIED' | 'CORS_MISCONFIGURED';
};

const parseAllowedOrigins = (value = ''): string[] => {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let parsed: URL;
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

const getAllowedOrigins = (): string[] => parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || ''
);

const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true;
  return getAllowedOrigins().includes(origin);
};

const createCorsError = (origin?: string): CorsError => {
  const configured = getAllowedOrigins();
  const error = new Error(
    configured.length
      ? `CORS: Origin غير مصرح به — ${origin}`
      : 'CORS: لا توجد Origins مسموح بها — اضبط ALLOWED_ORIGINS'
  ) as CorsError;
  error.status = 403;
  error.code = configured.length ? 'CORS_ORIGIN_DENIED' : 'CORS_MISCONFIGURED';
  return error;
};

const corsOrigin = (origin: string | undefined, callback: CorsCallback): void => {
  try {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(createCorsError(origin));
  } catch (error: unknown) {
    const corsError = error instanceof Error
      ? error as CorsError
      : new Error('CORS: فشل التحقق من Origin') as CorsError;
    corsError.status = 500;
    corsError.code = 'CORS_MISCONFIGURED';
    callback(corsError);
  }
};

const corsConfig = {
  corsOrigin,
  createCorsError,
  getAllowedOrigins,
  isOriginAllowed,
  parseAllowedOrigins,
};

export { corsOrigin, createCorsError, getAllowedOrigins, isOriginAllowed, parseAllowedOrigins };
export default corsConfig;
