// server.js — FULLY PATCHED (Flow-1 Audit)
// ✅ VULN-03:  app.set('io', io) بدل middleware — io متاح في كل controller دون الاعتماد على ترتيب التسجيل
// ✅ LOGIC-01: إضافة COOKIE_SECRET و NODE_ENV لقائمة REQUIRED_ENV
// ✅ محافظة كاملة على: connectRedis-first · gracefulShutdown · uncaughtException · unhandledRejection

require('dotenv').config();

// ✅ LOGIC-01: COOKIE_SECRET و NODE_ENV إلزاميان
// COOKIE_SECRET: يُستخدم في cookieParser لتوقيع الكوكيز — بدونه الكوكيز غير محمية
// NODE_ENV:      يتحكم في منطق production/dev في helmet · errorHandler · rateLimiter · CORS
const REQUIRED_ENV = [
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRE',
  'JWT_REFRESH_EXPIRE',
  'ALLOWED_ORIGINS',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'COOKIE_SECRET',
  'NODE_ENV',
];

const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error(
    '❌ [Startup] متغيرات بيئة إلزامية مفقودة:\n',
    missingEnv.map((k) => `  • ${k}`).join('\n')
  );
  process.exit(1);
}

const http             = require('http');
const app              = require('./app');
const connectDB        = require('./config/db');
const { initCronJobs } = require('./jobs/cronJobs');
const { initSocket }   = require('./socket');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

// ✅ VULN-03: initSocket أولاً للحصول على instance
const io = initSocket(server);

// ✅ VULN-03: app.set('io', io) — الطريقة الصحيحة معمارياً لتمرير التبعيات في Express
//
// المشكلة مع الطريقة القديمة (middleware):
//   app.use((req, res, next) => { req.io = io; next(); });
//   هذا الـ middleware يُسجَّل في server.js بعد أن سُجِّلت المسارات في app.js
//   Express ينفِّذ middlewares بترتيب تسجيلها → req.io = undefined في الـ controllers
//
// الحل مع app.set:
//   يُخزِّن io على مستوى الـ app instance مباشرةً — متاح دائماً عبر req.app.get('io')
//   بغض النظر عن ترتيب تسجيل المسارات أو الـ middlewares
//
// ⚠️  تذكير للـ Controllers: استبدل req.io بـ req.app.get('io')
app.set('io', io);

// ── دالة تنظيف الموارد ────────────────────────────────────────
const cleanupResources = async (isHttpListening) => {
  try {
    if (io && isHttpListening) {
      try {
        await new Promise((resolve, reject) =>
          io.close((closeErr) => (closeErr ? reject(closeErr) : resolve()))
        );
        console.log('✅ Socket.io أُغلق بالكامل');
      } catch (socketErr) {
        console.warn('⚠️ تنبيه أثناء إغلاق Socket.io (تم التجاوز):', socketErr.message);
      }
    } else if (io) {
      io.disconnectSockets(true);
      console.log('✅ تم فصل جلسات Socket.io النشطة');
    }

    const mongoose = require('mongoose');
    if (mongoose && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      console.log('✅ MongoDB أُغلق بأمان');
    }

    process.exit(0);
  } catch (shutdownErr) {
    console.error('❌ خطأ فادح أثناء الـ Cleanup:', shutdownErr);
    process.exit(1);
  }
};

// ── Graceful Shutdown المركزي ──────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 [${signal}] بدء الإغلاق الآمن للمنظومة...`);

  const isListening = !!(server && server.listening);

  if (isListening) {
    server.close(async (err) => {
      if (err) console.error('❌ خطأ أثناء إغلاق HTTP server:', err);
      else     console.log('🛑 تم إغلاق خادم HTTP بنجاح.');
      await cleanupResources(true);
    });
  } else {
    console.log('ℹ️ خادم HTTP لم يكن في حالة تشغيل نشطة.');
    cleanupResources(false);
  }

  setTimeout(() => {
    console.error('⚠️ الإغلاق تجاوز المهلة (15 ثانية) — إغلاق قسري');
    process.exit(1);
  }, 15_000).unref();
};

// ── Process Event Handlers ─────────────────────────────────────
process.on('uncaughtException', (err) => {
  if (err.isOperational) {
    console.error('⚠️ [uncaughtException] خطأ تشغيلي (لا إغلاق):', {
      message: err.message,
      code:    err.code,
    });
    return;
  }
  console.error('💥 [uncaughtException] خطأ برمجي — إغلاق فوري:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ [unhandledRejection]:', reason);
  gracefulShutdown('unhandledRejection');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── ترتيب التهيئة الصحيح ──────────────────────────────────────
const { connectRedis } = require('./middlewares/rateLimiter');

(async () => {
  try {
    // 1) Redis أولاً — rateLimiter يحتاجه قبل أول طلب
    await connectRedis();

    // 2) MongoDB
    await connectDB();
    console.log('✅ MongoDB متصل بنجاح');

    // 3) HTTP Server
    server.listen(PORT, () => {
      console.log(`🚀 الخادم على المنفذ ${PORT} — البيئة: ${process.env.NODE_ENV}`);

      // 4) Cron Jobs — فشلها لا يوقف الخادم
      try {
        initCronJobs();
        console.log('⏰ Cron Jobs تعمل بنجاح');
      } catch (cronErr) {
        console.error('❌ فشل Cron Jobs (الخادم مستمر):', cronErr);
      }
    });
  } catch (err) {
    console.error('❌ فشل حرج في الـ Startup:', err);
    gracefulShutdown('STARTUP_FAILURE');
  }
})();