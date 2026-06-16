// server.js — Flow 1 FINAL FIXED WITH ADVANCED GRACEFUL SHUTDOWN
// ✅ FIX-01: connectRedis() قبل connectDB() وقبل server.listen — يضمن Redis جاهز عند أول طلب
// ✅ FIX-02: io.close() يتم استدعاؤه فقط إذا كان السيرفر يعمل فعلياً لحماية العملية من ERR_SERVER_NOT_RUNNING
// ✅ FIX-03: uncaughtException يميّز بين Operational errors و Programmer errors
// ✅ FIX-04: unhandledRejection يستدعي gracefulShutdown 
// ✅ FIX-05: دالة cleanupResources ذكية ومحمية بـ try/catch داخلي لكل مورد

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

// ── دالة مساعدة لتنظيف الموارد التابعة (Sockets & DB) ──────────
const cleanupResources = async (isHttpListening) => {
  try {
    // 1. إغلاق الـ Socket.io بأمان فقط إذا كان سيرفر الـ HTTP يعمل
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
      // إذا انهار السيرفر قبل الـ listen، نقوم فقط بفصل جِلسات المشتركين دون قفل المفسر الشبكي داخلياً
      io.disconnectSockets(true);
      console.log('✅ تم فصل جلسات Socket.io النشطة لتأمين الخروج الحفاظي');
    }

    // 2. إغلاق الـ MongoDB بأمان
    const mongoose = require('mongoose');
    if (mongoose && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
      console.log('✅ MongoDB أُغلق بأمان');
    }

    process.exit(0);
  } catch (shutdownErr) {
    console.error('❌ خطأ فادح أثناء تنظيف الموارد وعملية الـ Cleanup:', shutdownErr);
    process.exit(1);
  }
};

// ── Graceful Shutdown المركزي ──────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 [${signal}] بدء الإغلاق الآمن للمنظومة...`);

  const isListening = !!(server && server.listening);

  if (isListening) {
    server.close(async (err) => {
      if (err) {
        console.error('❌ خطأ أثناء إغلاق HTTP server:', err);
      } else {
        console.log('🛑 تم إغلاق خادم HTTP بنجاح.');
      }
      await cleanupResources(true);
    });
  } else {
    console.log('ℹ️ خادم HTTP لم يكن في حالة تشغيل نشطة (تم تخطي أمر Close الحمائي).');
    cleanupResources(false);
  }

  // إغلاق قسري بعد 15 ثانية إذا لم ينتهِ الـ graceful shutdown
  setTimeout(() => {
    console.error('⚠️ الإغلاق تجاوز المهلة المحددة (15 ثانية) — إغلاق قسري فوراً');
    process.exit(1);
  }, 15_000).unref();
};

// ── uncaughtException — تمييز Operational vs Programmer errors ──
process.on('uncaughtException', (err) => {
  if (err.isOperational) {
    console.error('⚠️ [uncaughtException] خطأ عملي تشغيلي وصل للـ global handler (لا إغلاق):', {
      message: err.message,
      code:    err.code,
    });
    return; 
  }
  console.error('💥 [uncaughtException] خطأ برمجي بنيوي — إغلاق آمن فوري:', err);
  gracefulShutdown('uncaughtException');
});

// unhandledRejection يستدعي gracefulShutdown
process.on('unhandledRejection', (reason) => {
  console.error('❌ [unhandledRejection] — Promise رُفض دون catch مخصص:', reason);
  gracefulShutdown('unhandledRejection');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── ترتيب التهيئة الصحيح والمحمي ──────────────────────────────
const { connectRedis } = require('./middlewares/rateLimiter');

(async () => {
  try {
    // 1) Redis أولاً — rateLimiter يحتاجه عند أول طلب لمنع ثغرات الـ Memory Fallback المفاجئة
    await connectRedis();

    // 2) MongoDB
    await connectDB();
    console.log('✅ MongoDB متصل بنجاح');

    // 3) HTTP Server
    server.listen(PORT, () => {
      console.log(
        `🚀 الخادم على المنفذ ${PORT} — البيئة التشغيلية: ${process.env.NODE_ENV || 'development'}`
      );

      // 4) Cron Jobs — فشلها لا يوقف الخادم الأساسي
      try {
        initCronJobs();
        console.log('⏰ Cron Jobs تعمل بنجاح');
      } catch (cronErr) {
        console.error('❌ فشل تشغيل الـ Cron Jobs التلقائية (الخادم مستمر بوضعه الطبيعي):', cronErr);
      }
    });
  } catch (err) {
    console.error('❌ فشل حرج أثناء مرحلة الـ Startup البنيوية:', err);
    gracefulShutdown('STARTUP_FAILURE');
  }
})();