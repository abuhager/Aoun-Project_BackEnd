// app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { globalLimiter } = require('./middlewares/rateLimiter');
const errorHandler = require('./middlewares/errorHandler');
const AppError = require('./utils/AppError');

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
app.disable('x-powered-by');

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

    return cb(
      new AppError(
        `CORS: Origin غير مصرح به — ${origin}`,
        403,
        'CORS_ORIGIN_DENIED'
      )
    );
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

// 404 → مرره للـ centralized error handler
app.use((req, _res, next) => {
  next(
    new AppError(
      `المسار غير موجود: ${req.method} ${req.originalUrl}`,
      404,
      'ROUTE_NOT_FOUND'
    )
  );
});

// Centralized error handler — لازم يكون الأخير
app.use(errorHandler);

module.exports = app;