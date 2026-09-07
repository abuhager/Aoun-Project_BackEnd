import Notification from '../models/Notification.js';
import AppError from './AppError.js';
import { toNotificationDto } from '../dtos/notificationDto.js';
import { SOCKET_EVENTS } from '../socket/contracts.js';
import { emitToUser } from '../socket/emitter.js';
import mongoose from 'mongoose';
import runMongoTransaction from './mongoTransaction.js';
import outboxService from '../services/outboxService.js';

type NotificationPayload = {
  type?: string;
  email?: string | null;
  title?: string;
  body?: string;
  message?: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  itemId?: unknown;
  conversationId?: unknown;
};

type NotificationTarget = {
  _id?: unknown;
  email?: string | null;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const CRITICAL_NOTIFICATION_TYPES = Object.freeze([
  'admin_ban',
  'admin_warning',
  'account_suspended',
]);

const normalizeActionUrl = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AppError(
      'رابط الإشعار غير صالح',
      400,
      'INVALID_NOTIFICATION_ACTION_URL'
    );
  }

  const normalized = value.trim();
  if (
    normalized.length > 500
    || !Notification.isInternalActionPath(normalized)
  ) {
    throw new AppError(
      'رابط الإشعار يجب أن يكون مساراً داخلياً',
      400,
      'INVALID_NOTIFICATION_ACTION_URL'
    );
  }
  return normalized;
};

const normalizeRequiredText = (
  value: unknown,
  field: string,
  maxLength: number
): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new AppError(
      `${field} مطلوب لإرسال الإشعار`,
      400,
      'NOTIFICATION_CONTENT_REQUIRED'
    );
  }
  return normalized.slice(0, maxLength);
};

const normalizeMetadata = (metadata: unknown): Record<string, unknown> => {
  if (metadata == null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new AppError(
      'بيانات الإشعار الإضافية غير صالحة',
      400,
      'INVALID_NOTIFICATION_METADATA'
    );
  }

  let serialized;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    throw new AppError(
      'بيانات الإشعار الإضافية غير قابلة للحفظ',
      400,
      'INVALID_NOTIFICATION_METADATA'
    );
  }

  if (Buffer.byteLength(serialized, 'utf8') > 4096) {
    throw new AppError(
      'بيانات الإشعار الإضافية كبيرة جداً',
      400,
      'NOTIFICATION_METADATA_TOO_LARGE'
    );
  }

  return metadata as Record<string, unknown>;
};

const normalizeEntityId = (value: unknown, field: string): string | null => {
  if (value == null || value === '') return null;
  const candidate = typeof value === 'object' && value !== null && '_id' in value
    ? (value as NotificationTarget)._id
    : value;
  if (!mongoose.isObjectIdOrHexString(candidate)) {
    throw new AppError(`${field} غير صالح`, 400, 'INVALID_NOTIFICATION_REFERENCE');
  }
  return String(candidate);
};

async function notifyUser(userId: unknown, payload: NotificationPayload = {}) {
  const target = userId && typeof userId === 'object'
    ? userId as NotificationTarget
    : null;
  const actualUserId = normalizeEntityId(target?._id ?? userId, 'userId');

  if (!actualUserId) {
    throw new AppError('userId مطلوب لإرسال الإشعار', 400, 'USER_ID_REQUIRED');
  }
  if (typeof payload.type !== 'string' || !Notification.NOTIFICATION_TYPES.includes(payload.type)) {
    throw new AppError('نوع الإشعار غير صالح', 400, 'INVALID_NOTIFICATION_TYPE');
  }
  const notificationType = payload.type;

  const userEmail = payload.email ?? target?.email ?? null;
  const title = normalizeRequiredText(
    payload.title ?? 'إشعار جديد',
    'عنوان الإشعار',
    160
  );
  const body = normalizeRequiredText(
    payload.body ?? payload.message,
    'محتوى الإشعار',
    1000
  );
  const actionUrl = normalizeActionUrl(payload.actionUrl);
  const metadata = normalizeMetadata(payload.metadata);

  const notificationData = {
    user: actualUserId,
    type: notificationType,
    title,
    body,
    itemId: normalizeEntityId(payload.itemId, 'itemId'),
    conversationId: normalizeEntityId(payload.conversationId, 'conversationId'),
    actionUrl,
    metadata,
  };

  const isCritical = CRITICAL_NOTIFICATION_TYPES.includes(notificationType);
  const notification = isCritical
    ? await runMongoTransaction(async (session) => {
      const [created] = await Notification.create([notificationData], { session });
      await outboxService.enqueueCriticalNotificationEmail({
        userId: actualUserId,
        email: userEmail,
        title,
        body,
        actionUrl,
      }, created._id, session);
      return created;
    })
    : await Notification.create(notificationData);

  try {
    emitToUser(
      actualUserId,
      SOCKET_EVENTS.NOTIFICATION_NEW,
      toNotificationDto(notification)
    );
  } catch (error: unknown) {
    console.error('[notifyUser Socket Error]:', getErrorMessage(error));
  }

  return notification;
}

notifyUser.CRITICAL_TYPES = CRITICAL_NOTIFICATION_TYPES;
notifyUser.normalizeActionUrl = normalizeActionUrl;
notifyUser.normalizeMetadata = normalizeMetadata;

export default notifyUser;
