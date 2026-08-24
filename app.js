const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const { corsOrigin } = require('./config/cors');
const { globalLimiter, publicLimiter } = require('./middlewares/rateLimiter');
const maintenanceMode = require('./middlewares/maintenanceMode');
const errorHandler = require('./middlewares/errorHandler');
const AppError = require('./utils/AppError');

const app = express();

const trustProxyValue = process.env.TRUST_PROXY
  ?? (process.env.NODE_ENV === 'production' ? '1' : 'loopback');
app.set('trust proxy', /^\d+$/.test(trustProxyValue) ? Number(trustProxyValue) : trustProxyValue);
app.disable('x-powered-by');

const HPP_WHITELIST = new Set(
  (process.env.HPP_WHITELIST || 'category,status,trustLevel')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const isSafeRequestId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value);

app.use((req, res, next) => {
  const incomingId = req.headers['x-request-id'];
  req.id = isSafeRequestId(incomingId) ? incomingId : randomUUID();
  res.setHeader('X-Request-ID', req.id);
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
const skipMultipart = (parser) => (req, res, next) => {
  if (req.is('multipart/form-data')) return next();
  return parser(req, res, next);
};

app.use(skipMultipart(jsonParser));
app.use(skipMultipart(urlencodedParser));
app.use(cookieParser(process.env.COOKIE_SECRET));

const sanitizeObject = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);

  for (const key of Object.keys(value)) {
    if (
      key.startsWith('$')
      || key.includes('.')
      || ['__proto__', 'prototype', 'constructor'].includes(key)
    ) {
      delete value[key];
      continue;
    }
    sanitizeObject(value[key], seen);
  }
  return value;
};

const collapseDuplicateParameters = (value) => {
  if (!value || typeof value !== 'object') return value;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (Array.isArray(fieldValue) && !HPP_WHITELIST.has(key)) {
      value[key] = fieldValue.at(-1);
    }
  }
  return value;
};

app.use((req, _res, next) => {
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

app.get('/health/live', publicLimiter, (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get(['/health', '/health/ready'], publicLimiter, (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbOk = dbState === 1;

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    database: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] ?? 'unknown',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', require('./routes'));

app.use((req, _res, next) => {
  next(new AppError(
    `المسار غير موجود: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  ));
});

app.use(errorHandler);

module.exports = app;
