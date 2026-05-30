const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { globalLimiter } = require('./middlewares/rateLimiter');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const phoneRoutes = require('./routes/phone');
const hubRoutes = require('./routes/hubs');
const adminRoutes = require('./routes/admin');
const ratingRoutes = require('./routes/ratings');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const leaderboardRoutes = require('./routes/leaderboard');
const settingsRoutes = require('./routes/settings');
const donationRequestRoutes = require('./routes/donationRequests');
const conversationRoutes = require('./routes/conversations');

const app = express();

app.set('trust proxy', 1);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`CORS: Origin غير مصرح به — ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

app.use(globalLimiter);

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/phone', phoneRoutes);
app.use('/api/hubs', hubRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/donation-requests', donationRequestRoutes);
app.use('/api/conversations', conversationRoutes);

app.use((req, res) => {
  res.status(404).json({
    msg: `المسار غير موجود: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, _req, res, _next) => {
  const isDev = process.env.NODE_ENV !== 'production';

  console.error('[Error]', err.message);
  if (isDev && err.stack) {
    console.error(err.stack);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] ?? 'حقل';
    return res.status(409).json({
      msg: `${field} مستخدم مسبقاً`,
      code: 'DUPLICATE_KEY',
    });
  }

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(422).json({
      msg: 'بيانات غير صالحة',
      errors,
      code: 'VALIDATION_ERROR',
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ msg: 'معرّف غير صحيح' });
  }

  if (err.message?.includes('CORS')) {
    return res.status(403).json({ msg: err.message });
  }

  return res.status(err.status || 500).json({
    msg: isDev ? err.message : 'حدث خطأ داخلي في الخادم 🛠️',
    code: err.code || undefined,
  });
});

module.exports = app;