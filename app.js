// app.js — النسخة المصحَّحة كاملاً
// ✅ SEC-01:  CORS Fallback عند ALLOWED_ORIGINS فارغة في dev/production
// ✅ SEC-02:  إزالة req.params من global sanitizer (لا قيمة له هنا)
// ✅ PERF-01: إنشاء parser instances مرة واحدة خارج الـ wrapper
// ✅ ARCH-03: تجميع Routes عبر routes/index.js

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const hpp          = require('hpp');

const { globalLimiter } = require('./middlewares/rateLimiter');
const errorHandler      = require('./middlewares/errorHandler');
const AppError          = require('./utils/AppError');

const app = express();

// ── Trust Proxy (مطلوب لـ Render/Railway/Vercel) ─────────────
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── CORS Origins من env ──────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── Helmet — Security Headers ────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc:     ["'self'", "https://res.cloudinary.com", "data:"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", process.env.API_URL].filter(Boolean),
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── CORS ─────────────────────────────────────────────────────
// ✅ SEC-01: إذا كانت ALLOWED_ORIGINS فارغة في production → خطأ واضح
//           إذا فارغة في development → نسمح بكل شيء لتسهيل العمل
const corsOptions = {
  origin(origin, cb) {
    // طلبات server-to-server (SSR, Postman, curl) — بدون Origin header
    if (!origin) return cb(null, true);

    // ⚠️ ALLOWED_ORIGINS فارغة
    if (ALLOWED_ORIGINS.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        // Development: نسمح ونُحذّر في console
        console.warn(`[CORS] ⚠️  ALLOWED_ORIGINS غير مضبوطة — تم السماح لـ: ${origin}`);
        return cb(null, true);
      }
      // Production: رفض قاطع مع رسالة واضحة
      return cb(
        new AppError(
          'CORS: لا توجد origins مسموح بها — تأكد من ضبط ALLOWED_ORIGINS في متغيرات البيئة',
          403,
          'CORS_MISCONFIGURED'
        )
      );
    }

    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    return cb(
      new AppError(`CORS: Origin غير مصرح به — ${origin}`, 403, 'CORS_ORIGIN_DENIED')
    );
  },
  credentials:          true,
  methods:              ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:       ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders:       ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ── Body Parsing ─────────────────────────────────────────────
// ✅ PERF-01: إنشاء instances مرة واحدة عند startup — لا يُعاد إنشاؤها مع كل طلب
const _jsonParser       = express.json({ limit: '100kb' });
const _urlencodedParser = express.urlencoded({ extended: true, limit: '100kb' });

// تخطي multipart/form-data — multer يتولى تحليله داخل الـ routes
const skipMultipart = (parser) => (req, res, next) => {
  if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) return next();
  parser(req, res, next);
};

app.use(skipMultipart(_jsonParser));
app.use(skipMultipart(_urlencodedParser));
app.use(cookieParser());

// ── NoSQL Injection Sanitization ────────────────────────────
// ✅ SEC-02: حذف req.params — قيمته دائماً {} في global middleware
//            (params تُضبط داخل كل router، وليس قبله)
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
  if (req.body  && Object.keys(req.body).length)  _sanitize(req.body);
  if (req.query && Object.keys(req.query).length) _sanitize(req.query);
  // ❌ req.params محذوف — لا قيمة له هنا
  next();
});

// ── HTTP Parameter Pollution ─────────────────────────────────
app.use(hpp({ whitelist: ['category', 'status', 'trustLevel'] }));

// ── Global Rate Limiter ──────────────────────────────────────
app.use('/api', globalLimiter);

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// ── API Routes — ✅ ARCH-03: مجمَّعة عبر routes/index.js ────
app.use('/api', require('./routes'));

// ── 404 Handler ──────────────────────────────────────────────
app.use((req, _res, next) => {
  next(new AppError(
    `المسار غير موجود: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  ));
});

// ── Centralized Error Handler — يجب أن يكون الأخير دائماً ───
app.use(errorHandler);

module.exports = app;