import type { ClientSession } from 'mongoose';
import OutboxEvent from '../models/OutboxEvent.js';
import WorkerHeartbeat from '../models/WorkerHeartbeat.js';

type OutboxCreateInput = {
  type: 'verification_email' | 'password_reset_email' | 'critical_notification_email';
  encryptedPayload: string;
  idempotencyKey: string;
  maxAttempts?: number;
};

const enqueue = async (input: OutboxCreateInput, session?: ClientSession | null) => {
  const [event] = await OutboxEvent.create([input], session ? { session } : {});
  return event;
};

const claimNext = (workerId: string, staleBefore: Date) => OutboxEvent.findOneAndUpdate(
  {
    attempts: { $lt: 20 },
    $or: [
      { status: 'pending', availableAt: { $lte: new Date() } },
      { status: 'processing', lockedAt: { $lte: staleBefore } },
    ],
    $expr: { $lt: ['$attempts', '$maxAttempts'] },
  },
  {
    $set: {
      status: 'processing',
      lockedAt: new Date(),
      lockedBy: workerId,
      lastErrorCode: null,
    },
    $inc: { attempts: 1 },
  },
  {
    sort: { availableAt: 1, createdAt: 1 },
    returnDocument: 'after',
  }
).select('+encryptedPayload');

const complete = (eventId: unknown, workerId: string) => OutboxEvent.updateOne(
  { _id: eventId, status: 'processing', lockedBy: workerId },
  {
    $set: {
      status: 'completed',
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
    },
  }
);

const fail = (
  eventId: unknown,
  workerId: string,
  attempts: number,
  maxAttempts: number,
  errorCode: string
) => {
  const dead = attempts >= maxAttempts;
  const delayMs = Math.min(15 * 60_000, 5_000 * (2 ** Math.max(0, attempts - 1)));
  return OutboxEvent.updateOne(
    { _id: eventId, status: 'processing', lockedBy: workerId },
    {
      $set: {
        status: dead ? 'dead' : 'pending',
        availableAt: dead ? new Date() : new Date(Date.now() + delayMs),
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: errorCode.slice(0, 160),
      },
    }
  );
};

const recordHeartbeat = (
  workerId: string,
  state: 'starting' | 'running' | 'stopped' | 'error',
  options: { processed?: boolean; errorCode?: string | null } = {}
) => WorkerHeartbeat.updateOne(
  { _id: 'outbox' },
  {
    $set: {
      state,
      workerId,
      heartbeatAt: new Date(),
      lastErrorCode: options.errorCode?.slice(0, 160) ?? null,
      ...(options.processed ? { lastProcessedAt: new Date() } : {}),
    },
  },
  { upsert: true }
);

const getHeartbeat = () => WorkerHeartbeat.findById('outbox').lean().maxTimeMS(1_000);

export default { enqueue, claimNext, complete, fail, recordHeartbeat, getHeartbeat };
export { enqueue, claimNext, complete, fail, recordHeartbeat, getHeartbeat };
