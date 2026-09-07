import type { ClientSession } from 'mongoose';
import User from '../models/User.js';
import type { EntityId } from '../services/serviceTypes.js';

// الكتابة على مستند المستخدم داخل transaction تجعل عمليات الحدود لنفس المستخدم
// تتعارض فعلياً، ثم تعيد withTransaction المحاولة على snapshot أحدث.
const acquireUserOperationLocks = async (
  userIds: EntityId[],
  session: ClientSession
): Promise<void> => {
  const orderedIds = [...new Set(userIds.map((id) => id.toString()))].sort();

  for (const userId of orderedIds) {
    const result = await User.updateOne(
      { _id: userId },
      { $inc: { operationVersion: 1 } },
      { session, timestamps: false }
    );

    if (result.matchedCount !== 1) {
      throw new Error('تعذر حجز قفل العملية للمستخدم');
    }
  }
};

export default acquireUserOperationLocks;
