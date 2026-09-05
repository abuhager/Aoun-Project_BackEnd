const mongoose = require('mongoose');

const { parsePositiveInteger } = require('./env');

const buildMongoOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const autoIndex = process.env.MONGO_AUTO_INDEX === 'true'
    || (!isProduction && process.env.MONGO_AUTO_INDEX !== 'false');

  const parsedFamily = Number.parseInt(process.env.MONGO_IP_FAMILY ?? '0', 10);
  const options: import('mongoose').ConnectOptions & { family?: 4 | 6 } = {
    maxPoolSize: parsePositiveInteger(process.env.MONGO_POOL_SIZE, 10, { max: 100 }),
    minPoolSize: parsePositiveInteger(process.env.MONGO_MIN_POOL_SIZE, 0, { min: 0, max: 20 }),
    serverSelectionTimeoutMS: parsePositiveInteger(process.env.MONGO_SERVER_SEL_TIMEOUT, 5_000),
    socketTimeoutMS: parsePositiveInteger(process.env.MONGO_SOCKET_TIMEOUT, 45_000),
    autoIndex,
  };

  if (parsedFamily === 4 || parsedFamily === 6) {
    options.family = parsedFamily;
  }

  return options;
};

const connectDB = async () => {
  const isProduction = process.env.NODE_ENV === 'production';

  await mongoose.connect(process.env.MONGO_URI, buildMongoOptions());

  console.log('[MongoDB] متصل بنجاح');

  const shouldSyncIndexes = process.env.MONGO_SYNC_INDEXES_ON_STARTUP === 'true'
    || (!isProduction && process.env.MONGO_SYNC_INDEXES_ON_STARTUP !== 'false');

  if (shouldSyncIndexes) {
    try {
      const ensureIndexes = require('../utils/ensureIndexes');
      await ensureIndexes();
      console.log('[MongoDB] تم التحقق من الفهارس');
    } catch (error) {
      if (process.env.MONGO_INDEXES_REQUIRED === 'true') throw error;
      console.error('[MongoDB] فشل التحقق من الفهارس والخادم مستمر:', error);
    }
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] انقطع الاتصال');
  });
  mongoose.connection.on('reconnected', () => {
    console.info('[MongoDB] أُعيد الاتصال');
  });
  mongoose.connection.on('error', (error: Error) => {
    console.error('[MongoDB] خطأ اتصال:', error.message);
  });
};

module.exports = connectDB;
module.exports.buildMongoOptions = buildMongoOptions;
