import crypto from 'node:crypto';
import os from 'node:os';
import outboxRepository from '../repositories/outboxRepository.js';
import emailService from '../services/emailService.js';
import { sendCriticalNotificationEmail } from '../services/criticalNotificationEmailService.js';
import { decryptOutboxPayload } from '../utils/outboxCrypto.js';
import type { CriticalNotificationEmailPayload } from '../services/outboxService.js';
import type { RegistrationGuidanceEmailPayload } from '../services/outboxService.js';
import type { CloudinaryDeletePayload } from '../services/outboxService.js';

type VerificationPayload = {
  to: string;
  otp: string;
  name: string;
  isStudent: boolean;
  expiryMinutes: number;
};
type ResetPayload = {
  to: string;
  resetToken: string;
  name: string;
  expiryMinutes: number;
};
type ClaimedEvent = {
  _id: unknown;
  type: string;
  encryptedPayload: string;
  attempts: number;
  maxAttempts: number;
};

const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const POLL_MS = Math.max(250, Number.parseInt(process.env.OUTBOX_POLL_MS ?? '2000', 10) || 2000);
const LOCK_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.OUTBOX_LOCK_TIMEOUT_MS ?? '120000', 10) || 120_000
);
const BATCH_SIZE = Math.min(
  100,
  Math.max(1, Number.parseInt(process.env.OUTBOX_BATCH_SIZE ?? '20', 10) || 20)
);

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopping = false;

const deliveryErrorCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; response?: { status?: unknown }; name?: unknown };
    const status = Number(record.response?.status);
    if (Number.isInteger(status)) return `EMAIL_HTTP_${status}`;
    if (typeof record.code === 'string') {
      return record.code.startsWith('EMAIL_')
        ? record.code
        : `EMAIL_${record.code}`;
    }
    if (typeof record.name === 'string') return record.name.slice(0, 160);
  }
  return 'OUTBOX_DELIVERY_FAILED';
};

const deliver = async (event: ClaimedEvent) => {
  if (event.type === 'verification_email') {
    const payload = decryptOutboxPayload<VerificationPayload>(event.encryptedPayload);
    await emailService.sendVerificationEmail(
      payload.to,
      payload.otp,
      payload.name,
      payload.isStudent,
      payload.expiryMinutes
    );
    return;
  }
  if (event.type === 'password_reset_email') {
    const payload = decryptOutboxPayload<ResetPayload>(event.encryptedPayload);
    await emailService.sendPasswordResetEmail(
      payload.to,
      payload.resetToken,
      payload.name,
      payload.expiryMinutes
    );
    return;
  }
  if (event.type === 'critical_notification_email') {
    const payload = decryptOutboxPayload<CriticalNotificationEmailPayload>(
      event.encryptedPayload
    );
    await sendCriticalNotificationEmail(payload);
    return;
  }
  if (event.type === 'registration_guidance_email') {
    const payload = decryptOutboxPayload<RegistrationGuidanceEmailPayload>(
      event.encryptedPayload
    );
    await emailService.sendRegistrationGuidanceEmail(payload.to, payload.name);
    return;
  }
  if (event.type === 'cloudinary_delete') {
    const payload = decryptOutboxPayload<CloudinaryDeletePayload>(event.encryptedPayload);
    const [{ deleteFromCloudinary }, { default: Item }] = await Promise.all([
      import('../utils/uploadToCloudinary.js'),
      import('../models/Item.js'),
    ]);
    await deleteFromCloudinary(payload.publicId);
    await Item.updateOne(
      { _id: payload.itemId, cloudinaryId: payload.publicId },
      { $set: { cloudinaryId: null, imageUrl: null } }
    );
    return;
  }
  throw new Error('OUTBOX_EVENT_TYPE_UNSUPPORTED');
};

export const processOutboxBatch = async (): Promise<number> => {
  let processed = 0;
  for (let index = 0; index < BATCH_SIZE && !stopping; index += 1) {
    const event = await outboxRepository.claimNext(
      WORKER_ID,
      new Date(Date.now() - LOCK_TIMEOUT_MS)
    ) as ClaimedEvent | null;
    if (!event) break;

    try {
      await deliver(event);
      await outboxRepository.complete(event._id, WORKER_ID);
      processed += 1;
    } catch (error: unknown) {
      const errorCode = deliveryErrorCode(error);
      await outboxRepository.fail(
        event._id,
        WORKER_ID,
        event.attempts,
        event.maxAttempts,
        errorCode
      );
      console.error('[Outbox] فشل تسليم حدث:', {
        eventId: String(event._id),
        type: event.type,
        attempt: event.attempts,
        errorCode,
      });
    }
  }
  return processed;
};

const tick = async () => {
  if (running || stopping) return;
  running = true;
  try {
    const processed = await processOutboxBatch();
    await outboxRepository.recordHeartbeat(WORKER_ID, 'running', {
      processed: processed > 0,
    });
  } catch (error: unknown) {
    const errorCode = deliveryErrorCode(error);
    console.error('[Outbox] فشل دورة العامل:', { errorCode });
    await outboxRepository.recordHeartbeat(WORKER_ID, 'error', { errorCode })
      .catch(() => undefined);
  } finally {
    running = false;
  }
};

export const startOutboxWorker = async () => {
  if (timer) return { workerId: WORKER_ID };
  stopping = false;
  await outboxRepository.recordHeartbeat(WORKER_ID, 'starting');
  await tick();
  timer = setInterval(() => void tick(), POLL_MS);
  return { workerId: WORKER_ID };
};

export const stopOutboxWorker = async () => {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;

  const deadline = Date.now() + 15_000;
  while (running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await outboxRepository.recordHeartbeat(WORKER_ID, 'stopped').catch(() => undefined);
};

export default { processOutboxBatch, startOutboxWorker, stopOutboxWorker };
