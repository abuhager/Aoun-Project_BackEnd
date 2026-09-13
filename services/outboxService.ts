import type { ClientSession } from 'mongoose';
import outboxRepository from '../repositories/outboxRepository.js';
import { encryptOutboxPayload } from '../utils/outboxCrypto.js';
import type { OutboxEventType } from '../models/OutboxEvent.js';

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

export type RegistrationGuidanceEmailPayload = {
  to: string;
  name: string;
};

export type LoginAlertEmailPayload = {
  to: string;
  name: string;
  occurredAt: string;
  ipAddress: string;
  userAgent: string;
};

export type CloudinaryDeletePayload = {
  publicId: string;
  itemId: string;
};

const enqueueEncrypted = (
  type: OutboxEventType,
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

export const enqueueRegistrationGuidanceEmail = (
  payload: RegistrationGuidanceEmailPayload,
  idempotencyKey: string
) => enqueueEncrypted('registration_guidance_email', payload, idempotencyKey);

export const enqueueLoginAlertEmail = (
  payload: LoginAlertEmailPayload,
  userId: unknown,
  sessionVersion: number
) => enqueueEncrypted(
  'login_alert_email',
  payload,
  `login-alert:${String(userId)}:${sessionVersion}`
);

export const enqueueCloudinaryDelete = (
  payload: CloudinaryDeletePayload,
  session?: ClientSession | null
) => enqueueEncrypted(
  'cloudinary_delete',
  payload,
  `cloudinary-delete:item:${payload.itemId}:${payload.publicId}`,
  session
);

export default {
  enqueueVerificationEmail,
  enqueuePasswordResetEmail,
  enqueueCriticalNotificationEmail,
  enqueueRegistrationGuidanceEmail,
  enqueueLoginAlertEmail,
  enqueueCloudinaryDelete,
};
