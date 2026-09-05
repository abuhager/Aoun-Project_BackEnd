const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const { corsOrigin } = require('./config/cors');
const { globalLimiter, publicLimiter } = require('./middlewares/rateLimiter');
const maintenanceMode = require('./middlewares/maintenanceMode');
const errorHandler = require('./middlewares/errorHandler');
const AppError = require('./utils/AppError');

const app = express();

const getBackgroundJobsHealth = () => {
  try {
    const { getCronStatus } = require('./jobs/cronJobs');
    return Object.fromEntries(
      Object.entries(getCronStatus() as Record<string, {
        lastStatus: string;
        scheduled: boolean;
        lastRun: string | null;
        lastFinishedAt?: string | null;
      }>).map(([name, job]) => [
        name,
        {
          status: job.lastStatus,
          scheduled: job.scheduled,
          lastRun: job.lastRun,
          lastFinishedAt: job.lastFinishedAt ?? null,
        },
      ])
    );
  } catch {
    return {};
  }
};

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

app.get(['/health', '/health/ready'], publicLimiter, (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  const dbOk = dbState === 1;

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    database: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] ?? 'unknown',
    backgroundJobs: getBackgroundJobsHealth(),
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', require('./routes'));

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(AppError.notFound(
    'المسار المطلوب غير موجود',
    'ROUTE_NOT_FOUND'
  ));
});

app.use(errorHandler);

module.exports = app;
