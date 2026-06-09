// server.js ✅ النسخة المصحّحة الكاملة
require('dotenv').config();

const http       = require('http');
const app        = require('./app');
const connectDB  = require('./config/db');
const { initCronJobs } = require('./jobs/cronJobs');
const { initSocket }   = require('./socket/socketHandler');

const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────
const io = initSocket(server);
app.set('io', io); // controllers تصل إليه عبر req.app.get('io')

// ── إصلاح S1 — Graceful Shutdown ─────────────────────────────
// يضمن إنهاء كل الطلبات الجارية قبل إغلاق الخادم
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 استقبلنا ${signal} — بدء الإغلاق الآمن...`);

  // 1. أوقف استقبال اتصالات جديدة
  server.close(async (err) => {
    if (err) {
      console.error('❌ خطأ أثناء إغلاق الخادم:', err);
      process.exit(1);
    }

    try {
      // 2. أغلق Socket.io بشكل نظيف
      await new Promise((resolve) => io.close(resolve));
      console.log('✅ Socket.io أُغلق');

      // 3. أغلق اتصال MongoDB
      const mongoose = require('mongoose');
      await mongoose.connection.close(false);
      console.log('✅ MongoDB أُغلق');

      console.log('✅ الإغلاق الآمن اكتمل');
      process.exit(0);
    } catch (shutdownErr) {
      console.error('❌ خطأ أثناء الإغلاق:', shutdownErr);
      process.exit(1);
    }
  });

  // ✅ Forced exit بعد 15 ثانية إذا تعطّل الإغلاق
  setTimeout(() => {
    console.error('⚠️ الإغلاق تجاوز 15 ثانية — إغلاق قسري');
    process.exit(1);
  }, 15_000).unref(); // unref() لمنع الـ timeout من إبقاء العملية حيّة
};

// ── Unhandled Errors ───────────────────────────────────────────
// ✅ أي promise يُرفض دون catch — يُسجَّل ولا يسقط الخادم
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ unhandledRejection:', { reason, promise });
  // لا نُنهي العملية هنا — فقط نسجّل ونترك errorHandler يتعامل معه
});

// ✅ أي استثناء synchronous غير متوقع
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException — إغلاق إجباري:', err);
  gracefulShutdown('uncaughtException');
});

// ── إشارات الإغلاق (Render/Docker/Kubernetes) ─────────────────
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // إيقاف مُخطَّط
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));  // Ctrl+C في dev

// ── تشغيل الخادم ───────────────────────────────────────────────
connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 الخادم يعمل على المنفذ ${PORT} — البيئة: ${process.env.NODE_ENV || 'development'}`);

      // ✅ إصلاح S2 — تغليف initCronJobs بـ try/catch
      try {
        initCronJobs();
        console.log('⏰ Cron Jobs تعمل');
      } catch (cronErr) {
        // لا نُوقف الخادم بسبب cron — فقط نسجّل
        console.error('❌ فشل تشغيل Cron Jobs:', cronErr);
      }
    });
  })
  .catch((err) => {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err);
    process.exit(1);
  });