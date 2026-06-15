// config/db.js — النسخة المصحّحة (Flow-1 Audit)
// ✅ إصلاح BUG-01: حذف gracefulShutdown من هنا كلياً — server.js هو المتحكم الوحيد
// ✅ إصلاح LOGIC-02: إضافة مراقبة أحداث الاتصال (disconnected / error / reconnected)
// ✅ إصلاح HC-02: maxPoolSize من env بدل hardcoded

const mongoose = require('mongoose');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    // ✅ HC-02: قيم قابلة للضبط من env بدون إعادة deploy
    maxPoolSize:              parseInt(process.env.MONGO_POOL_SIZE            || '10'),
    serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SEL_TIMEOUT  || '5000'),
    socketTimeoutMS:          parseInt(process.env.MONGO_SOCKET_TIMEOUT      || '45000'),
    family:                   4,
  });

  console.log('✅ MongoDB متصل بنجاح');

  // ✅ LOGIC-02: مراقبة دورة حياة الاتصال
  mongoose.connection.on('disconnected', () =>
    console.warn('⚠️  [MongoDB] انقطع الاتصال — Mongoose سيحاول إعادة الاتصال تلقائياً')
  );
  mongoose.connection.on('reconnected', () =>
    console.info('🔄 [MongoDB] أُعيد الاتصال بنجاح')
  );
  mongoose.connection.on('error', (err) =>
    console.error('❌ [MongoDB] خطأ في الاتصال:', err.message)
  );
};

// ✅ BUG-01: لا process.on هنا — server.js يُدير SIGTERM/SIGINT بشكل مركزي
module.exports = connectDB;