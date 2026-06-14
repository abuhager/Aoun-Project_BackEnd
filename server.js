// server.js — النسخة المصحّحة (Flow-1 Audit)
// ✅ إصلاح BUG-01: هذا الملف هو المتحكم الوحيد بـ SIGTERM/SIGINT — db.js لا يسجّل listeners
// ✅ إصلاح BUG-03: فحص متغيرات البيئة الإلزامية عند الـ startup قبل أي شيء

require('dotenv').config();

// ─────────────────────────────────────────────────────────────
// ✅ BUG-03: فحص إلزامي لمتغيرات البيئة — يُنهي العملية فوراً إذا كان ناقصاً
// أضف هنا كل متغير يجب أن يكون موجوداً قبل بدء الخادم
// ─────────────────────────────────────────────────────────────
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
    '❌ [Startup] متغيرات بيئة إلزامية مفقودة — أضفها في .env أو في Render/Vercel Dashboard:\n',
    missingEnv.map((k) => `  • ${k}`).join('\n')
  );
  process.exit(1);
}

const http      = require('http');
const app       = require('./app');
const connectDB = require('./config/db');
const { initCronJobs } = require('./jobs/cronJobs');
const { initSocket }   = require('./socket/socketHandler');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────
const io = initSocket(server);
app.set('io', io); // controllers تصل إليه عبر req.app.get('io')

// ─────────────────────────────────────────────────────────────
// ✅ BUG-01: Graceful Shutdown المركزي — الوحيد في المشروع
// db.js لا يسجّل SIGTERM/SIGINT — هذا الملف فقط هو المسؤول
// ─────────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 [${signal}] بدء الإغلاق الآمن للخادم...`);

  // 1. أوقف استقبال اتصالات HTTP جديدة
  server.close(async (err) => {
    if (err) {
      console.error('❌ خطأ أثناء إغلاق HTTP server:', err);
      process.exit(1);
    }

    try {
      // 2. أغلق Socket.io بشكل نظيف
      await new Promise((resolve) => io.close(resolve));
      console.log('✅ Socket.io أُغلق');

      // 3. أغلق اتصال MongoDB (Mongoose v7+ — Promise فقط)
      const mongoose = require('mongoose');
      await mongoose.connection.close(false);
      console.log('✅ MongoDB أُغلق');

      console.log('✅ الإغلاق الآمن اكتمل بنجاح');
      process.exit(0);
    } catch (shutdownErr) {
      console.error('❌ خطأ أثناء الإغلاق:', shutdownErr);
      process.exit(1);
    }
  });

  // ✅ Forced exit بعد 15 ثانية إذا تعطّل الإغلاق
  // .unref() يمنع الـ timeout من إبقاء العملية حيّة إذا أنهت مبكراً
  setTimeout(() => {
    console.error('⚠️  الإغلاق تجاوز 15 ثانية — إغلاق قسري');
    process.exit(1);
  }, 15_000).unref();
};

// ── Unhandled Errors ───────────────────────────────────────────
// ✅ أي Promise يُرفض دون catch — يُسجَّل ولا يسقط الخادم
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [unhandledRejection]:', { reason, promise });
  // لا نُنهي العملية — فقط نسجّل ونترك errorHandler يتعامل معه
});

// ✅ أي استثناء synchronous غير متوقع — يستوجب الإغلاق الآمن
process.on('uncaughtException', (err) => {
  console.error('💥 [uncaughtException] — إغلاق إجباري:', err);
  gracefulShutdown('uncaughtException');
});

// ── إشارات الإغلاق (Render / Docker / Kubernetes / Ctrl+C) ───
// ✅ BUG-01: نسجّل هنا فقط — db.js لا يسجّل هذه الإشارات
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // إيقاف مُخطَّط من المنصة
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));  // Ctrl+C في dev

// ── تشغيل الخادم ───────────────────────────────────────────────
connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(
        `🚀 الخادم يعمل على المنفذ ${PORT} — البيئة: ${process.env.NODE_ENV || 'development'}`
      );

      // ✅ تغليف initCronJobs بـ try/catch — فشله لا يوقف الخادم
      try {
        initCronJobs();
        console.log('⏰ Cron Jobs تعمل');
      } catch (cronErr) {
        console.error('❌ فشل تشغيل Cron Jobs:', cronErr);
      }
    });
  })
  .catch((err) => {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err);
    process.exit(1);
  });
