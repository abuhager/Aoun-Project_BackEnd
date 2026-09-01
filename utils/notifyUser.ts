const Notification = require('../models/Notification');
const User = require('../models/User');
const AppError = require('./AppError');
const SystemSettings = require('../models/SystemSettings');
const { toNotificationDto } = require('../dtos/notificationDto');
const { escapeHtml, getClientOrigin } = require('../services/emailService');
const { SOCKET_EVENTS } = require('../socket/contracts');
const { emitToUser } = require('../socket/emitter');

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

const getPlatformName = async () => {
  try {
    const settings = await SystemSettings.getCached();
    return settings?.platformName ?? 'عون';
  } catch {
    return 'عون';
  }
};

const CRITICAL_NOTIFICATION_TYPES = Object.freeze([
  'admin_ban',
  'admin_warning',
  'account_suspended',
]);

const normalizeActionUrl = (value) => {
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

const normalizeRequiredText = (value, field, maxLength) => {
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

const normalizeMetadata = (metadata) => {
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

  return metadata;
};

const toAbsoluteClientUrl = (actionUrl) => {
  if (!actionUrl) return null;
  try {
    const clientOrigin = getClientOrigin();
    const target = new URL(actionUrl, clientOrigin);
    return target.origin === clientOrigin ? target.toString() : null;
  } catch {
    return null;
  }
};

async function notifyUser(userId, payload: NotificationPayload = {}) {
  const hasUserFields = userId && typeof userId === 'object' && userId._id != null;
  const actualUserId = hasUserFields ? userId._id : userId;

  if (!actualUserId) {
    throw new AppError('userId مطلوب لإرسال الإشعار', 400, 'USER_ID_REQUIRED');
  }
  if (!Notification.NOTIFICATION_TYPES.includes(payload.type)) {
    throw new AppError('نوع الإشعار غير صالح', 400, 'INVALID_NOTIFICATION_TYPE');
  }

  const userEmail = payload.email ?? (hasUserFields ? userId.email : null);
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

  const notification = await Notification.create({
    user: actualUserId,
    type: payload.type,
    title,
    body,
    itemId: payload.itemId ?? null,
    conversationId: payload.conversationId ?? null,
    actionUrl,
    metadata,
  });

  try {
    emitToUser(
      actualUserId,
      SOCKET_EVENTS.NOTIFICATION_NEW,
      toNotificationDto(notification)
    );
  } catch (error) {
    console.error('[notifyUser Socket Error]:', error.message);
  }

  if (CRITICAL_NOTIFICATION_TYPES.includes(payload.type)) {
    let resolvedEmail = userEmail;
    if (!resolvedEmail) {
      try {
        const user = await User.findById(actualUserId).select('email').lean();
        resolvedEmail = user?.email ?? null;
      } catch (error) {
        console.warn(
          '[notifyUser] تعذر جلب بريد مستلم الإشعار:',
          error.message
        );
      }
    }

    if (resolvedEmail) {
      try {
        const platformName = await getPlatformName();
        const safePlatformName = escapeHtml(platformName);
        const safeTitle = escapeHtml(title);
        const safeBody = escapeHtml(body);
        const absoluteActionUrl = toAbsoluteClientUrl(actionUrl);
        const safeActionUrl = absoluteActionUrl
          ? escapeHtml(absoluteActionUrl)
          : null;
        const { fireSendEmail } = require('./sendEmail');

        fireSendEmail({
          email: resolvedEmail,
          subject: title,
          message: `
            <div dir="rtl" style="font-family:sans-serif;line-height:1.8;color:#191c1d;max-width:560px;margin:auto;">
              <h2 style="color:#c0392b;margin-bottom:8px;">${safeTitle}</h2>
              <p style="margin:0 0 16px;">${safeBody}</p>
              ${safeActionUrl
                ? `<a href="${safeActionUrl}"
                      style="display:inline-block;padding:10px 20px;background:#01696f;
                             color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
                       فتح منصة ${safePlatformName}
                     </a>`
                : ''
              }
              <hr style="border:none;border-top:1px solid #edeeef;margin:20px 0;" />
              <p style="font-size:11px;color:#747775;">
                هذا إشعار إداري رسمي من منصة ${safePlatformName}.
              </p>
            </div>
          `,
        }).catch((emailError) =>
          console.error(
            '[notifyUser Email Fallback] فشل الإرسال:',
            emailError.message
          )
        );
      } catch (emailError) {
        console.warn(
          '[notifyUser] تعذر تجهيز بريد الإشعار:',
          emailError.message
        );
      }
    } else {
      console.warn(
        `[notifyUser] إشعار حرج "${payload.type}" للمستخدم ${actualUserId}`
        + ' — لم يُرسل بريد لعدم توفر عنوان البريد.'
      );
    }
  }

  return notification;
}

notifyUser.CRITICAL_TYPES = CRITICAL_NOTIFICATION_TYPES;
notifyUser.normalizeActionUrl = normalizeActionUrl;
notifyUser.normalizeMetadata = normalizeMetadata;

module.exports = notifyUser;
