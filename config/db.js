// config/db.js — Flow 1 FINAL FIXED
// ✅ FIX-01: dbName صريح من env بدل الاعتماد على URI فقط
// ✅ FIX-02: جميع الخيارات من env — لا hardcoded values
// ✅ FIX-03: EVENT HANDLERS: reconnected + disconnected + close تُسجَّل كاملاً
// ✅ FIX-04: serverSelectionTimeoutMS + socketTimeoutMS من env

const mongoose = require('mongoose');

const connectDB = async () => {
  const uri     = process.env.MONGO_URI;
  const dbName  = process.env.MONGO_DB_NAME;     // ✅ FIX-01: اسم الـ DB من env
  const poolMin = parseInt(process.env.MONGO_POOL_MIN || '2');
  const poolMax = parseInt(process.env.MONGO_POOL_MAX || '10');

  const options = {
    dbName,                                        // ✅ FIX-01: صريح — لا اعتماد على URI path
    serverSelectionTimeoutMS: parseInt(           // ✅ FIX-04
      process.env.MONGO_SERVER_SELECTION_TIMEOUT || '5000'
    ),
    socketTimeoutMS: parseInt(                    // ✅ FIX-04
      process.env.MONGO_SOCKET_TIMEOUT || '45000'
    ),
    minPoolSize: poolMin,                          // ✅ FIX-02
    maxPoolSize: poolMax,                          // ✅ FIX-02
    maxIdleTimeMS: parseInt(
      process.env.MONGO_MAX_IDLE_TIME || '60000'
    ),
    heartbeatFrequencyMS: parseInt(
      process.env.MONGO_HEARTBEAT_FREQUENCY || '10000'
    ),
  };

  // ✅ FIX-03: Event Handlers قبل الاتصال — لا يفوت أي حدث
  mongoose.connection.on('connected', () =>
    console.info(`✅ [MongoDB] متصل — DB: "${mongoose.connection.name}"`)
  );
  mongoose.connection.on('disconnected', () =>
    console.warn('⚠️ [MongoDB] انقطع الاتصال')
  );
  mongoose.connection.on('reconnected', () =>
    console.info('✅ [MongoDB] أُعيد الاتصال')
  );
  mongoose.connection.on('close', () =>
    console.info('ℹ️ [MongoDB] الاتصال مُغلق')
  );
  mongoose.connection.on('error', (err) =>
    console.error('❌ [MongoDB] خطأ في الاتصال:', err.message)
  );

  await mongoose.connect(uri, options);
};

module.exports = connectDB;
