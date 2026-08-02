// app.js — FULLY PATCHED (Flow-1 Audit)
// ✅ VULN-01:  /health محمي بـ publicLimiter — منع bot flooding
// ✅ VULN-02:  CSP connectSrc يغطي ws:// و wss:// — Socket.io لن يُحجب
// ✅ PERF-01:  helmet() instance واحدة تُبنى عند bootstrap — nonce ديناميكي عبر دالة
// ✅ LOGIC-02: cookieParser(COOKIE_SECRET) — الكوكيز موقَّعة وآمنة من التلاعب
// ✅ محافظة كاملة على: Request-ID · CSP Nonce · CORS · mongoSanitize · HPP · skipMultipart

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const hpp          = require('hpp');
const mongoose     = require('mongoose');

const { randomBytes, randomUUID } = require('crypto');

// ✅ VULN-01: استيراد publicLimiter لحماية /health
const { globalLimiter, publicLimiter } = require('./middlewares/rateLimiter');
const errorHandler                     = require('./middlewares/errorHandler');
const AppError                         = require('./utils/AppError');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── CORS Origins من env ────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── HPP Whitelist من env ───────────────────────────────────────
const HPP_WHITELIST = (process.env.HPP_WHITELIST || 'category,status,trustLevel')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ✅ VULN-02: استخلاص ws:// و wss:// من API_URL ديناميكياً
// السبب: Socket.io يتصل عبر WebSocket — CSP يجب أن يُصرِّح بهذه البروتوكولات صراحةً
// وإلا سيرفض المتصفح الاتصال حتى لو كان CORS صحيحاً
const API_URL    = process.env.API_URL || '';
const WS_ORIGIN  = API_URL
  ? API_URL.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
  : '';
const WSS_ORIGIN = API_URL
  ? API_URL.replace(/^http:\/\//, 'wss://').replace(/^https:\/\//, 'wss://')
  : '';

// ── Request ID Middleware ──────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── CSP Nonce per Request ──────────────────────────────────────
app.use((_req, res, next) => {
  res.locals.cspNonce = randomBytes(16).toString('base64');
  res.setHeader('X-CSP-Nonce', res.locals.cspNonce);
  next();
});

// ✅ PERF-01: Helmet instance واحدة تُبنى مرة عند تحميل الـ module
// الـ nonce يُقرأ ديناميكياً عبر دالة (_req, res) => ... في كل طلب
// بدلاً من استدعاء helmet({ ... })(req, res, next) من جديد لكل طلب
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],

      imgSrc: ["'self'", 'https://res.cloudinary.com', 'data:'],

      // nonce ديناميكي — دالة تُستدعى لكل طلب لاستخلاص القيمة من res.locals
      scriptSrc: ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc:  ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],

      // ✅ VULN-02: ws:// و wss:// مضافان — Socket.io يعمل بدون حجب CSP
      connectSrc: [
        "'self'",
        ...(API_URL    ? [API_URL]    : []),
        ...(WS_ORIGIN  ? [WS_ORIGIN]  : []),
        ...(WSS_ORIGIN ? [WSS_ORIGIN] : []),
      ],

      objectSrc: ["'none'"],
      frameSrc:  ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

app.use(helmetMiddleware);

// ── CORS ───────────────────────────────────────────────────────
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[CORS] ⚠️  ALLOWED_ORIGINS غير مضبوطة — تم السماح لـ: ${origin}`);
        return cb(null, true);
      }
      const err  = new Error('CORS: لا توجد origins مسموح بها — تأكد من ضبط ALLOWED_ORIGINS في متغيرات البيئة');
      err.status = 403;
      err.code   = 'CORS_MISCONFIGURED';
      return cb(err);
    }

    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    const err  = new Error(`CORS: Origin غير مصرح به — ${origin}`);
    err.status = 403;
    err.code   = 'CORS_ORIGIN_DENIED';
    return cb(err);
  },
  credentials:          true,
  methods:              ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:       ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders:       ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-Request-ID'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ── Body Parsing ───────────────────────────────────────────────
const _jsonParser       = express.json({ limit: '100kb' });
const _urlencodedParser = express.urlencoded({ extended: true, limit: '100kb' });

const skipMultipart = (parser) => (req, res, next) => {
  if (req.is('multipart/form-data')) return next();
  parser(req, res, next);
};

app.use(skipMultipart(_jsonParser));
app.use(skipMultipart(_urlencodedParser));

// ✅ LOGIC-02: تمرير COOKIE_SECRET لتوقيع الكوكيز
// الكوكيز بدون توقيع يمكن للمستخدم تعديل قيمتها يدوياً في المتصفح
// مع التوقيع: أي تعديل يُبطل التوقيع ويُكتشف فوراً عند القراءة بـ req.signedCookies
app.use(cookieParser(process.env.COOKIE_SECRET));

// ── NoSQL Injection Sanitization ──────────────────────────────
const _sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (/^\$|\./.test(key)) {
      console.warn(`[mongoSanitize] ⚠️  حقل مشبوه تم حذفه: ${key}`);
      delete obj[key];
    } else if (typeof obj[key] === 'object') {
      _sanitize(obj[key]);
    }
  }
  return obj;
};

app.use((req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.body  && typeof req.body  === 'object') _sanitize(req.body);
  if (req.query && typeof req.query === 'object') _sanitize(req.query);
  next();
});

// ── HTTP Parameter Pollution ───────────────────────────────────
app.use(hpp({ whitelist: HPP_WHITELIST }));

// ── Global Rate Limiter ────────────────────────────────────────
app.use('/api', globalLimiter);

// ── Health Check ───────────────────────────────────────────────
// ✅ VULN-01: publicLimiter يمنع أي bot من قرع هذا الـ endpoint آلاف المرات
// /health ليس داخل /api لذا كان خارج نطاق globalLimiter تماماً
app.get('/health', publicLimiter, (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbOk    = dbState === 1;

  res.status(dbOk ? 200 : 503).json({
    status:    dbOk ? 'ok' : 'degraded',
    database:  ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] ?? 'unknown',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV || 'development',
  });
});

// ── API Routes ─────────────────────────────────────────────────
app.use('/api', require('./routes'));

// ── 404 Handler ────────────────────────────────────────────────
app.use((req, _res, next) => {
  next(new AppError(
    `المسار غير موجود: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  ));
});

// ── Centralized Error Handler ──────────────────────────────────
app.use(errorHandler);

module.exports = app;