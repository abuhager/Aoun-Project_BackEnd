import mongoose from 'mongoose';
import { parsePositiveInteger } from './env.js';
import ensureIndexes, { verifyIndexes } from '../utils/ensureIndexes.js';

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
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI غير مضبوط');

  await mongoose.connect(mongoUri, buildMongoOptions());

  console.log('[MongoDB] متصل بنجاح');

  const shouldSyncIndexes = process.env.MONGO_SYNC_INDEXES_ON_STARTUP === 'true'
    || (!isProduction && process.env.MONGO_SYNC_INDEXES_ON_STARTUP !== 'false');
  const indexesRequired = process.env.MONGO_INDEXES_REQUIRED === 'true';

  if (shouldSyncIndexes) {
    try {
      await ensureIndexes();
      console.log('[MongoDB] تمت مزامنة الفهارس والتحقق منها');
    } catch (error) {
      if (indexesRequired) throw error;
      console.error('[MongoDB] فشلت مزامنة الفهارس والخادم مستمر:', error);
    }
  } else if (isProduction && indexesRequired) {
    // فحص قراءة فقط: يمنع بدء الإنتاج بفهرس ناقص من دون تعديل قاعدة البيانات.
    await verifyIndexes();
    console.log('[MongoDB] الفهارس المطلوبة مطابقة للـschemas');
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

export default connectDB;

export { buildMongoOptions };
