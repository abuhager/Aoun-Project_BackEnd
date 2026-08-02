// config/db.js — الإصلاح النهائي المؤكد لـ PERF-02
const mongoose = require('mongoose');

const rawPoolSize = parseInt(process.env.MONGO_POOL_SIZE || '10');
const poolSize    = (!isNaN(rawPoolSize) && rawPoolSize >= 1 && rawPoolSize <= 100)
  ? rawPoolSize
  : (() => {
      console.warn('[DB] ⚠️ MONGO_POOL_SIZE غير صالح — استخدام القيمة الافتراضية 10');
      return 10;
    })();

const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize:              poolSize,
    serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SEL_TIMEOUT || '5000'),
    socketTimeoutMS:          parseInt(process.env.MONGO_SOCKET_TIMEOUT     || '45000'),
    family: 4,
  });

  console.log('✅ MongoDB متصل بنجاح');

  // ✅ PERF-02: الاستيراد المباشر — الملف يُصدِّر الدالة نفسها عبر module.exports = ensureIndexes
  try {
    const ensureIndexes = require('../utils/ensureIndexes'); // ← بدون { } — استيراد مباشر
    await ensureIndexes();
    console.log('✅ [DB] Indexes تم التحقق منها / إنشاؤها');
  } catch (indexErr) {
    console.warn('[DB] ⚠️ ensureIndexes فشل (غير حرج — الخادم مستمر):', indexErr.message);
  }

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

module.exports = connectDB;