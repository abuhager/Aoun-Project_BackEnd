// server.js — Flow 1 FINAL FIXED
// ✅ FIX-01: connectRedis() قبل connectDB() وقبل server.listen — يضمن Redis جاهز عند أول طلب
// ✅ FIX-02: io.close() مع reject عند الخطأ — لا إخفاء للفشل
// ✅ FIX-03: uncaughtException يميّز بين Operational errors و Programmer errors
// ✅ FIX-04: unhandledRejection يستدعي gracefulShutdown (محفوظ من النسخة السابقة)
// ✅ FIX-05: باقي المنطق محفوظ كما هو

require('dotenv').config();

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
const { initSocket }   = require('./socket/socketHandler');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

const io = initSocket(server);
app.set('io', io);

// ── Graceful Shutdown المركزي ──────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 [${signal}] بدء الإغلاق الآمن...`);

  server.close(async (err) => {
    if (err) {
      console.error('❌ خطأ أثناء إغلاق HTTP server:', err);
      process.exit(1);
    }
    try {
      // ✅ FIX-02: reject عند الخطأ — لا نُكمل الإغلاق صامتاً عند فشل Socket.io
      await new Promise((resolve, reject) =>
        io.close((closeErr) => (closeErr ? reject(closeErr) : resolve()))
      );
      console.log('✅ Socket.io أُغلق');

      const mongoose = require('mongoose');
      await mongoose.connection.close(false);
      console.log('✅ MongoDB أُغلق');

      process.exit(0);
    } catch (shutdownErr) {
      console.error('❌ خطأ أثناء الإغلاق:', shutdownErr);
      process.exit(1);
    }
  });

  // إغلاق قسري بعد 15 ثانية إذا لم ينته graceful shutdown
  setTimeout(() => {
    console.error('⚠️  الإغلاق تجاوز 15 ثانية — إغلاق قسري');
    process.exit(1);
  }, 15_000).unref();
};

// ── ✅ FIX-03: uncaughtException — تمييز Operational vs Programmer errors ──
// Operational errors (AppError.isOperational = true):
//   وصولها للـ global handler يعني أنها لم تُعالَج في errorHandler
//   نُسجّل فقط ولا نوقف الخادم — الخادم لا يزال في حالة سليمة
// Programmer errors (TypeError, ReferenceError, etc.):
//   تعني وجود bug في الكود نفسه — الخادم قد يكون في حالة تالفة
//   يجب الإغلاق الآمن والسماح لـ PM2/Docker بإعادة التشغيل
process.on('uncaughtException', (err) => {
  if (err.isOperational) {
    // AppError وصل للـ global handler — خطأ في المعالجة لا في البنية
    console.error('⚠️ [uncaughtException] خطأ عملياً وصل للـ global handler (لا إغلاق):', {
      message: err.message,
      code:    err.code,
    });
    return; // الخادم يستمر — لا حاجة للإغلاق
  }
  // Programmer error — الخادم قد يكون في حالة تالفة
  console.error('💥 [uncaughtException] خطأ برمجي — إغلاق آمن:', err);
  gracefulShutdown('uncaughtException');
});

// ✅ FIX-04 (محفوظ): unhandledRejection يستدعي gracefulShutdown
// غالباً من promise في طلب واحد — graceful shutdown يسمح بإتمام الطلبات الجارية
process.on('unhandledRejection', (reason) => {
  console.error('❌ [unhandledRejection] — Promise رُفض دون catch:', reason);
  gracefulShutdown('unhandledRejection');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── ✅ FIX-01: ترتيب التهيئة الصحيح ──────────────────────────
// المشكلة السابقة: Redis يتصل بشكل async غير منتظَر داخل rateLimiter.js
// أول الطلبات قد تُعالَج بـ MemoryStore رغم وجود Redis (ثغرة في rate limiting)
// الحل: connectRedis أولاً ← connectDB ← server.listen
// هكذا يكون Redis + MongoDB جاهزَين تماماً قبل استقبال أي طلب

// ملاحظة: connectRedis تُصدَّر من rateLimiter.js — لا تغيير في البنية الخارجية
const { connectRedis } = require('./middlewares/rateLimiter');

(async () => {
  try {
    // 1) Redis أولاً — rateLimiter يحتاجه عند أول طلب
    await connectRedis();

    // 2) MongoDB
    await connectDB();
    console.log('✅ MongoDB متصل');

    // 3) HTTP Server
    server.listen(PORT, () => {
      console.log(
        `🚀 الخادم على المنفذ ${PORT} — البيئة: ${process.env.NODE_ENV || 'development'}`
      );

      // 4) Cron Jobs — فشلها لا يوقف الخادم
      try {
        initCronJobs();
        console.log('⏰ Cron Jobs تعمل');
      } catch (cronErr) {
        console.error('❌ فشل تشغيل Cron Jobs (الخادم يستمر):', cronErr);
      }
    });
  } catch (err) {
    console.error('❌ فشل الـ startup:', err);
    process.exit(1);
  }
})();
