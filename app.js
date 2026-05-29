// app.js — إعداد Express بدون تشغيل
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');

const { globalLimiter } = require('./middlewares/rateLimiter');

const authRoutes   = require('./routes/auth');
const itemRoutes   = require('./routes/items');
const phoneRoutes  = require('./routes/phone');
const hubRoutes    = require('./routes/hubs');
const adminRoutes  = require('./routes/admin');
const ratingRoutes = require('./routes/ratings');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const leaderboardRoutes  = require('./routes/leaderboard');
const settingsRoutes        = require('./routes/settings');
const donationRequestRoutes = require('./routes/donationRequests');

const app = express();

// ── Trust Proxy ───────────────────────────────────────────────
app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin غير مصرح به — ${origin}`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
}));

// ── Rate Limiter + Body Parsers ───────────────────────────────
app.use(globalLimiter);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/items',   itemRoutes);
app.use('/api/phone',   phoneRoutes);
app.use('/api/hubs',    hubRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/leaderboard',  leaderboardRoutes);
app.use('/api/settings',           settingsRoutes);
app.use('/api/donation-requests',  donationRequestRoutes);
// ── Health Check ──────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
);

// ── Global Error Handler ──────────────────────────────────────
app.use((err, _req, res, _next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('[Error]', err.message, isDev ? err.stack : '');

  if (err.name === 'ValidationError') return res.status(400).json({ msg: err.message });
  if (err.name === 'CastError')       return res.status(400).json({ msg: 'معرّف غير صحيح' });
  if (err.message?.includes('CORS'))  return res.status(403).json({ msg: err.message });

  res.status(err.status || 500).json({
    msg: isDev ? err.message : 'حدث خطأ داخلي في الخادم 🛠️',
  });
});

module.exports = app;