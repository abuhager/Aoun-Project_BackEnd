import type { ClientSession } from 'mongoose';
import outboxRepository from '../repositories/outboxRepository.js';
import { encryptOutboxPayload } from '../utils/outboxCrypto.js';

type VerificationEmailPayload = {
  to: string;
  otp: string;
  name: string;
  isStudent: boolean;
  expiryMinutes: number;
};

type PasswordResetEmailPayload = {
  to: string;
  resetToken: string;
  name: string;
  expiryMinutes: number;
};

export type CriticalNotificationEmailPayload = {
  userId: string;
  email?: string | null;
  title: string;
  body: string;
  actionUrl: string | null;
};

const enqueueEncrypted = (
  type: 'verification_email' | 'password_reset_email' | 'critical_notification_email',
  payload: unknown,
  idempotencyKey: string,
  session?: ClientSession | null
) => outboxRepository.enqueue({
  type,
  encryptedPayload: encryptOutboxPayload(payload),
  idempotencyKey,
}, session);

export const enqueueVerificationEmail = (
  payload: VerificationEmailPayload,
  idempotencyKey: string,
  session?: ClientSession | null
) => enqueueEncrypted('verification_email', payload, idempotencyKey, session);

export const enqueuePasswordResetEmail = (
  payload: PasswordResetEmailPayload,
  idempotencyKey: string,
  session?: ClientSession | null
) => enqueueEncrypted('password_reset_email', payload, idempotencyKey, session);

export const enqueueCriticalNotificationEmail = (
  payload: CriticalNotificationEmailPayload,
  notificationId: unknown,
  session?: ClientSession | null
) => enqueueEncrypted(
  'critical_notification_email',
  payload,
  `critical-notification:${String(notificationId)}`,
  session
);

export default {
  enqueueVerificationEmail,
  enqueuePasswordResetEmail,
  enqueueCriticalNotificationEmail,
};
