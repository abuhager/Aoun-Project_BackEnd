// app.js — Flow 1 FINAL FIXED
// ✅ FIX-01: require('crypto') خارج middleware — لا re-require لكل طلب
// ✅ FIX-02: cspNonce على res.locals بدل req + إرساله كـ header لـ Next.js
// ✅ FIX-03: skipMultipart يستخدم req.is() بدل مقارنة نصية هشّة
// ✅ FIX-04: CORS callback يستخدم Error عادي مع .status بدل AppError (cors lib لا تضمن تمرير AppError)
// ✅ FIX-05: HPP_WHITELIST من env
// ✅ FIX-06: /health يتحقق من MongoDB readyState

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const hpp          = require('hpp');
const mongoose     = require('mongoose');

// ✅ FIX-01: require مرة واحدة عند bootstrap — لا تكرار لكل طلب
const { randomBytes } = require('crypto');

const { globalLimiter } = require('./middlewares/rateLimiter');
const errorHandler      = require('./middlewares/errorHandler');
const AppError          = require('./utils/AppError');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── CORS Origins من env ──────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── HPP Whitelist من env ──────────────────────────────────────
const HPP_WHITELIST = (process.env.HPP_WHITELIST || 'category,status,trustLevel')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── CSP Nonce per Request ─────────────────────────────────────
// ✅ FIX-01 + FIX-02:
//   - randomBytes مستوردة مرة واحدة (لا require داخل middleware)
//   - nonce يُخزَّن على res.locals (المكان الصحيح للبيانات المرتبطة بالـ response)
//   - يُرسَل كـ header → Next.js middleware.ts يقرأه ويحقنه في HTML
app.use((_req, res, next) => {
  res.locals.cspNonce = randomBytes(16).toString('base64');
  // يُرسَل للـ frontend حتى يستخدمه في CSP الخاص بـ Next.js
  res.setHeader('X-CSP-Nonce', res.locals.cspNonce);
  next();
});

// ── Helmet — Security Headers ─────────────────────────────────
app.use((req, res, next) => {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc:     ["'self'", "https://res.cloudinary.com", "data:"],
        scriptSrc:  ["'self'", `'nonce-${res.locals.cspNonce}'`],
        // unsafe-inline محذوف — nonce فقط للـ inline styles الضرورية
        styleSrc:   ["'self'", `'nonce-${res.locals.cspNonce}'`],
        connectSrc: ["'self'", process.env.API_URL].filter(Boolean),
        objectSrc:  ["'none'"],
        frameSrc:   ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })(req, res, next);
});

// ── CORS ──────────────────────────────────────────────────────
// ✅ FIX-04:
//   المشكلة السابقة: تمرير AppError لـ cors callback
//   مكتبة cors لا تضمن أن تُمرِّر AppError لـ Express error chain بشكل صحيح
//   في بعض النسخ تُرسل 500 مجردة بدلاً من الـ 403 المطلوب
//   الحل: Error عادي مع .status يقرأه errorHandler عبر err.status fallback
const corsOptions = {
  origin(origin, cb) {
    // طلبات بدون origin (server-to-server, curl, mobile) — مسموحة
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[CORS] ⚠️  ALLOWED_ORIGINS غير مضبوطة — تم السماح لـ: ${origin}`);
        return cb(null, true);
      }
      // ✅ FIX-04: Error عادي مع .status بدل AppError
      const err = new Error('CORS: لا توجد origins مسموح بها — تأكد من ضبط ALLOWED_ORIGINS في متغيرات البيئة');
      err.status = 403;
      err.code   = 'CORS_MISCONFIGURED';
      return cb(err);
    }

    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    // ✅ FIX-04: Error عادي مع .status
    const err = new Error(`CORS: Origin غير مصرح به — ${origin}`);
    err.status = 403;
    err.code   = 'CORS_ORIGIN_DENIED';
    return cb(err);
  },
  credentials:          true,
  methods:              ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:       ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders:       ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ── Body Parsing ──────────────────────────────────────────────
const _jsonParser       = express.json({ limit: '100kb' });
const _urlencodedParser = express.urlencoded({ extended: true, limit: '100kb' });

// ✅ FIX-03:
//   المشكلة السابقة: مقارنة نصية على content-type header هشّة
//   مهاجم يمكنه إرسال content-type: multipart/form-data مع جسم JSON لتجاوز الـ parser
//   الحل: req.is() — Express API الرسمي للـ MIME type detection، يتعامل مع الـ boundary بشكل صحيح
const skipMultipart = (parser) => (req, res, next) => {
  if (req.is('multipart/form-data')) return next();
  parser(req, res, next);
};

app.use(skipMultipart(_jsonParser));
app.use(skipMultipart(_urlencodedParser));
app.use(cookieParser());

// ── NoSQL Injection Sanitization ─────────────────────────────
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
  // تخطي GET/HEAD/OPTIONS — لا body فيها → يُقلل العمليات على 60-70% من الطلبات
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (req.body  && typeof req.body === 'object')  _sanitize(req.body);
  if (req.query && typeof req.query === 'object') _sanitize(req.query);
  next();
});

// ── HTTP Parameter Pollution ──────────────────────────────────
app.use(hpp({ whitelist: HPP_WHITELIST }));

// ── Global Rate Limiter ───────────────────────────────────────
app.use('/api', globalLimiter);

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
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

// ── API Routes ────────────────────────────────────────────────
app.use('/api', require('./routes'));

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, _res, next) => {
  next(new AppError(
    `المسار غير موجود: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  ));
});

// ── Centralized Error Handler ─────────────────────────────────
app.use(errorHandler);

module.exports = app;
