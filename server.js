// server.js
// ✅ Phase 1 Fix:
//    Bug #13 — إضافة maxPoolSize + serverSelectionTimeoutMS لاتصال MongoDB
//              إعداد trust proxy الصحيح لـ Render + Vercel deployment

require('dotenv').config();
const express     = require('express');
const mongoose    = require('mongoose');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const authRoutes  = require('./routes/auth');
const itemRoutes  = require('./routes/items');
const phoneRoutes = require('./routes/phone');  
const hubRoutes = require('./routes/hubs');
const adminRoutes = require('./routes/admin');
const ratingRoutes = require('./routes/ratings');
const reportRoutes = require('./routes/reports');


const { startCronJobs } = require('./utils/cronJobs');
const app = express();

// ✅ Fix Bug #13 — trust proxy لازم قبل أي middleware يعتمد على IP
// Render.com يضع load balancer أمام السيرفر
// القيمة 1 = نثق بأول proxy في السلسلة فقط (الأأمن)
app.set('trust proxy', 1);

// ── Security Headers ───────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin غير مصرح به — ${origin}`));
  },
  credentials:     true,   // ✅ مطلوب لـ httpOnly cookies
  methods:         ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders:  ['Content-Type', 'Authorization'],
  exposedHeaders:  ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
}));

// ── Global Rate Limiter ────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 دقيقة
  max:      process.env.NODE_ENV !== 'production' ? 10000 : 200,
  message:  { msg: '🛑 طلبات كثيرة جداً، حاول بعد 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV !== 'production',
});
app.use(globalLimiter);

// ── Auth Rate Limiter (أشد صرامة) ────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      process.env.NODE_ENV !== 'production' ? 1000 : 30,
  message:  { msg: '🔐 محاولات تسجيل دخول كثيرة، انتظر 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV !== 'production',
});

// ── Body Parsers ─────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',  authLimiter, authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/phone', phoneRoutes);
app.use('/api/hubs', hubRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ratings',  ratingRoutes);
app.use('/api/reports',  reportRoutes);

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    // ✅ لا نكشف معلومات النظام الداخلية
    timestamp: new Date().toISOString(),
  })
);

// ── Global Error Handler ──────────────────────────────────────
app.use((err, _req, res, _next) => {
  // ✅ لا نكشف stack trace في production
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('[Error]', err.message, isDev ? err.stack : '');

  if (err.name === 'ValidationError') {
    return res.status(400).json({ msg: err.message });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ msg: 'معرّف غير صحيح' });
  }
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ msg: err.message });
  }

  res.status(err.status || 500).json({
    msg: isDev ? err.message : 'حدث خطأ داخلي في الخادم 🛠️',
  });
});

// ── MongoDB Connection ────────────────────────────────────────
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // ✅ Fix Bug #13 — خيارات الاتصال المُحسَّنة
      maxPoolSize:              10,    // ✅ جديد — حد أقصى 10 اتصالات متوازية
      serverSelectionTimeoutMS: 5000,  // ✅ جديد — 5 ثوانٍ للاتصال
      socketTimeoutMS:          45000, // ✅ جديد — 45 ثانية timeout للعمليات
      family:                   4,     // ✅ إجبار IPv4 (يتجنب مشاكل Render DNS)
    });
    console.log('✅ MongoDB متصل بنجاح');
  } catch (err) {
    console.error('❌ فشل الاتصال بـ MongoDB:', err.message);
    process.exit(1);
  }
};

// ── Graceful Shutdown ─────────────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`\n[${signal}] إيقاف تشغيل الخادم بشكل آمن...`);
  mongoose.connection.close(false, () => {
    console.log('✅ اتصال MongoDB مُغلَق');
    process.exit(0);
  });
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
    startCronJobs();
  });
});

module.exports = app;