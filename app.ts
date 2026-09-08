import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { corsOrigin } from './config/cors.js';
import { globalLimiter, publicLimiter } from './middlewares/rateLimiter.js';
import maintenanceMode from './middlewares/maintenanceMode.js';
import errorHandler from './middlewares/errorHandler.js';
import AppError from './utils/AppError.js';
import apiRoutes from './routes/index.js';
import getRuntimeReadiness from './utils/runtimeHealth.js';
import { recordHttpMetrics, renderPrometheusMetrics } from './utils/metrics.js';

const app = express();

const trustProxyValue = process.env.TRUST_PROXY
  ?? (process.env.NODE_ENV === 'production' ? '1' : 'loopback');
app.set('trust proxy', /^\d+$/.test(trustProxyValue) ? Number(trustProxyValue) : trustProxyValue);
app.disable('x-powered-by');

const HPP_WHITELIST = new Set(
  (process.env.HPP_WHITELIST || 'category,status,trustLevel')
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean)
);

const isSafeRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value);

app.use((req: Request, res: Response, next: NextFunction) => {
  const incomingId = req.headers['x-request-id'];
  const requestId = isSafeRequestId(incomingId) ? incomingId : randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});
app.use(recordHttpMetrics);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'X-Request-ID'],
  optionsSuccessStatus: 204,
}));

const jsonParser = express.json({ limit: '100kb' });
const urlencodedParser = express.urlencoded({ extended: true, limit: '100kb' });
const skipMultipart = (parser: RequestHandler): RequestHandler => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.is('multipart/form-data')) return next();
  return parser(req, res, next);
};

app.use(skipMultipart(jsonParser));
app.use(skipMultipart(urlencodedParser));
app.use(cookieParser(process.env.COOKIE_SECRET));

const sanitizeObject = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (
      key.startsWith('$')
      || key.includes('.')
      || ['__proto__', 'prototype', 'constructor'].includes(key)
    ) {
      delete record[key];
      continue;
    }
    sanitizeObject(record[key], seen);
  }
  return value;
};

const collapseDuplicateParameters = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  for (const [key, fieldValue] of Object.entries(record)) {
    if (Array.isArray(fieldValue) && !HPP_WHITELIST.has(key)) {
      record[key] = fieldValue.at(-1);
    }
  }
  return value;
};

app.use((req: Request, _res: Response, next: NextFunction) => {
  const query = collapseDuplicateParameters(sanitizeObject({ ...req.query }));
  Object.defineProperty(req, 'query', {
    value: query,
    configurable: true,
    enumerable: true,
  });

  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
    if (req.is('application/x-www-form-urlencoded')) {
      collapseDuplicateParameters(req.body);
    }
  }
  next();
});

app.use('/api', globalLimiter);
app.use('/api', maintenanceMode);

app.get('/health/live', publicLimiter, (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get(['/health', '/health/ready'], publicLimiter, async (_req: Request, res: Response) => {
  const health = await getRuntimeReadiness();

  res.status(health.ready ? 200 : 503).json({
    status: health.status,
    database: health.database.state,
    checks: {
      database: health.database,
      redis: health.redis,
      backgroundJobs: health.backgroundJobs,
      outboxWorker: health.outboxWorker,
    },
    backgroundJobs: health.backgroundJobs.jobs,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

const metricsTokenMatches = (authorization: string | undefined): boolean => {
  const configured = process.env.METRICS_TOKEN;
  const provided = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!configured || !provided) return false;
  const expectedHash = createHash('sha256').update(configured).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
};

app.get('/metrics', publicLimiter, (req: Request, res: Response, next: NextFunction) => {
  if (process.env.METRICS_ENABLED !== 'true') {
    return next(AppError.notFound('المسار المطلوب غير موجود', 'ROUTE_NOT_FOUND'));
  }
  if (
    process.env.NODE_ENV === 'production'
    && !metricsTokenMatches(req.headers.authorization)
  ) {
    return next(AppError.unauthorized('غير مصرح بقراءة المقاييس', 'METRICS_UNAUTHORIZED'));
  }

  res.type('text/plain; version=0.0.4; charset=utf-8');
  return res.status(200).send(renderPrometheusMetrics());
});

app.use('/api', apiRoutes);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(AppError.notFound(
    'المسار المطلوب غير موجود',
    'ROUTE_NOT_FOUND'
  ));
});

app.use(errorHandler);

export default app;
