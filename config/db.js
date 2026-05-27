// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize:              10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS:          45000,
      family:                   4,
    });
    console.log('✅ MongoDB متصل بنجاح');
  } catch (err) {
    console.error('❌ فشل الاتصال بـ MongoDB:', err.message);
    process.exit(1);
  }
};

const gracefulShutdown = (signal) => {
  console.log(`\n[${signal}] إيقاف تشغيل الخادم بشكل آمن...`);
  mongoose.connection.close(false, () => {
    console.log('✅ اتصال MongoDB مُغلَق');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

module.exports = connectDB;