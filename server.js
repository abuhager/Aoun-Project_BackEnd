// server.js — النسخة المصحَّحة كاملاً
// ✅ LOGIC-01: unhandledRejection يُعالَج بشكل صحيح (تسجيل فقط — بدون crash)
// ✅ LOGIC-02: initCronJobs يُشغَّل داخل listen callback (بعد DB + HTTP جاهزَين)
// ✅ gracefulShutdown يُغلق io + mongoose بالترتيب الصحيح

require('dotenv').config();

// ── فحص متغيرات البيئة الإلزامية عند الـ Startup ─────────────
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

const http              = require('http');
const app               = require('./app');
const connectDB         = require('./config/db');
const { initCronJobs }  = require('./jobs/cronJobs');
const { initSocket }    = require('./socket/socketHandler');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────
const io = initSocket(server);
app.set('io', io);

// ── Graceful Shutdown المركزي ─────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 [${signal}] بدء الإغلاق الآمن...`);

  server.close(async (err) => {
    if (err) {
      console.error('❌ خطأ أثناء إغلاق HTTP server:', err);
      process.exit(1);
    }
    try {
      // 1. أغلق Socket.io
      await new Promise((resolve) => io.close(resolve));
      console.log('✅ Socket.io أُغلق');

      // 2. أغلق MongoDB
      const mongoose = require('mongoose');
      await mongoose.connection.close(false);
      console.log('✅ MongoDB أُغلق');

      process.exit(0);
    } catch (shutdownErr) {
      console.error('❌ خطأ أثناء الإغلاق:', shutdownErr);
      process.exit(1);
    }
  });

  // Forced exit بعد 15 ثانية إذا تعطّل الإغلاق
  setTimeout(() => {
    console.error('⚠️  الإغلاق تجاوز 15 ثانية — إغلاق قسري');
    process.exit(1);
  }, 15_000).unref();
};

// ── ✅ LOGIC-01: unhandledRejection — تسجيل فقط، بدون crash ──
// Node.js v15+ يُنهي العملية افتراضياً عند unhandledRejection
// نتحكم نحن بالسلوك: نسجّل ونترك PM2/Docker يُعيد التشغيل إذا لزم
process.on('unhandledRejection', (reason) => {
  console.error('❌ [unhandledRejection] — Promise رُفض دون catch:', reason);
  // لا gracefulShutdown هنا — unhandledRejection قد يكون في طلب واحد
  // ويجب ألا يُسقط الخادم بالكامل بسببه
});

// uncaughtException أخطر — يعني الـ event loop تعطّل → إغلاق إجباري
process.on('uncaughtException', (err) => {
  console.error('💥 [uncaughtException] — إغلاق إجباري:', err);
  gracefulShutdown('uncaughtException');
});

// إشارات الإغلاق (Render / Docker / Ctrl+C)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── تشغيل الخادم ─────────────────────────────────────────────
connectDB()
  .then(() => {
    console.log('✅ MongoDB متصل');

    server.listen(PORT, () => {
      console.log(
        `🚀 الخادم على المنفذ ${PORT} — البيئة: ${process.env.NODE_ENV || 'development'}`
      );

      // ✅ LOGIC-02: initCronJobs داخل listen callback
      // (بعد DB + HTTP جاهزَين — ضمان أن الـ jobs تجد الـ models جاهزة)
      try {
        initCronJobs();
        console.log('⏰ Cron Jobs تعمل');
      } catch (cronErr) {
        console.error('❌ فشل تشغيل Cron Jobs (الخادم يستمر):', cronErr);
      }
    });
  })
  .catch((err) => {
    console.error('❌ فشل الاتصال بـ MongoDB:', err);
    process.exit(1);
  });