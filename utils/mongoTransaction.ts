import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';

type TransactionWork<T> = (session: ClientSession) => Promise<T>;

// withTransaction يعيد المحاولة تلقائياً عند transient write conflicts في MongoDB.
// الفرع اليدوي موجود فقط لدعم جلسات الاختبارات الخفيفة القديمة.
const runMongoTransaction = async <T>(work: TransactionWork<T>): Promise<T> => {
  const session = await mongoose.startSession();

  try {
    if (typeof session.withTransaction === 'function') {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result as T;
    }

    session.startTransaction();
    try {
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    }
  } finally {
    await session.endSession();
  }
};

export default runMongoTransaction;
