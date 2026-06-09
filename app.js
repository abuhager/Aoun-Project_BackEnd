// app.js — النسخة الآمنة والمصحّحة بالكامل
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const hpp          = require('hpp');                     // ✅ إصلاح A1

const { globalLimiter } = require('./middlewares/rateLimiter');
const errorHandler      = require('./middlewares/errorHandler');
const AppError          = require('./utils/AppError');

const authRoutes          = require('./routes/auth');
const itemRoutes          = require('./routes/items');
const phoneRoutes         = require('./routes/phone');
const hubRoutes           = require('./routes/hubs');
const adminRoutes         = require('./routes/admin');
const ratingRoutes        = require('./routes/ratings');
const reportRoutes        = require('./routes/reports');
const notificationRoutes  = require('./routes/notifications');
const leaderboardRoutes   = require('./routes/leaderboard');
const settingsRoutes      = require('./routes/settings');
const donationRequestRoutes = require('./routes/donationRequests');
const conversationRoutes  = require('./routes/conversations');

const app = express();

// ── Trust proxy (مطلوب لـ Render/Railway/Vercel) ──────────────
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── CORS Origins من env ───────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ── Helmet — Security Headers ──────────────────────────────────
// ✅ إصلاح A5 — تعطيل CSP لأن الصور تأتي من Cloudinary CDN خارجي
// إذا أردت CSP كاملاً لاحقاً، حدّد directives يدوياً
app.use(
  helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "https://res.cloudinary.com", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", process.env.API_URL],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
})
);

// ── CORS ───────────────────────────────────────────────────────
const corsOptions = {
  origin(origin, cb) {
    // السماح بطلبات server-to-server (لا origin)
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    return cb(
      new AppError(
        `CORS: Origin غير مصرح به — ${origin}`,
        403,
        'CORS_ORIGIN_DENIED'
      )
    );
  },
  credentials:         true,
  methods:             ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:      ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders:      ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ── Body Parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// ── إصلاح A2 — NoSQL Injection Sanitization ───────────────────
// يمنع { "$gt": "" } في req.body / req.params / req.query
const _sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (/^\$|\./.test(key)) {
      console.warn(`[mongoSanitize] ⚠️ حقل مشبوه تم حذفه: ${key}`);
      delete obj[key];
    } else if (typeof obj[key] === 'object') {
      _sanitize(obj[key]);
    }
  }
  return obj;
};

app.use((req, _res, next) => {
  // ✅ تجنب الاستدعاء على طلبات GET/HEAD التي لا تحمل body
  if (req.body && Object.keys(req.body).length)   _sanitize(req.body);
  if (req.params && Object.keys(req.params).length) _sanitize(req.params);
  if (req.query && Object.keys(req.query).length)   _sanitize(req.query);
  next();
});

// ── إصلاح A1 — HTTP Parameter Pollution ──────────────────────
// يمنع ?sort=name&sort=email (مصفوفات غير متوقعة تكسر الـ query logic)
app.use(hpp({
  whitelist: ['category', 'status', 'trustLevel'], // ← اسمح بتعدد هذه فقط
}));

// ── Global Rate Limiter ────────────────────────────────────────
// ✅ إصلاح A3 — نُطبّقه على /api فقط، لا على /health
app.use('/api', globalLimiter);

// ── Health Check ───────────────────────────────────────────────
// ✅ إصلاح [SEC-04]: منع كشف تفاصيل السيرفر الداخلية والبيئة للعامة بدون حماية الـ limiter
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',             authRoutes);
app.use('/api/items',            itemRoutes);
app.use('/api/phone',            phoneRoutes);
app.use('/api/hubs',             hubRoutes);
app.use('/api/admin',            adminRoutes);
app.use('/api/ratings',          ratingRoutes);
app.use('/api/reports',          reportRoutes);
app.use('/api/notifications',    notificationRoutes);
app.use('/api/leaderboard',      leaderboardRoutes);
app.use('/api/settings',         settingsRoutes);
app.use('/api/donation-requests', donationRequestRoutes);
app.use('/api/conversations',    conversationRoutes);

// ── 404 Handler ────────────────────────────────────────────────
app.use((req, _res, next) => {
  next(
    new AppError(
      `المسار غير موجود: ${req.method} ${req.originalUrl}`,
      404,
      'ROUTE_NOT_FOUND'
    )
  );
});

// ── Centralized Error Handler — يجب أن يكون الأخير دائماً ─────
app.use(errorHandler);

module.exports = app;