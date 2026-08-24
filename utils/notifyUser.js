// utils/notifyUser.js — ✅ FIXED WITH NEW SOCKET MODULE IMPORT
const Notification   = require('../models/Notification');
const AppError       = require('./AppError');
const SystemSettings = require('../models/SystemSettings');
const { SOCKET_EVENTS } = require('../socket/contracts');
const { emitToUser } = require('../socket/emitter');

// ✅ جلب platformName من DB مع Cache
const getPlatformName = async () => {
  const settings = await SystemSettings.getCached();
  return settings?.platformName ?? 'عون';
};

const CRITICAL_NOTIFICATION_TYPES = Object.freeze([
  'admin_ban',
  'admin_warning',
  'account_suspended',
]);

async function notifyUser(userId, payload) {
  const hasUserFields = userId && typeof userId === 'object' && userId._id != null;
  const actualUserId  = hasUserFields ? userId._id : userId;
  const userEmail     = payload.email ?? (hasUserFields ? userId.email : null);
  const title         = payload.title ?? 'إشعار جديد';
  const body          = payload.body ?? payload.message;

  if (!actualUserId) {
    throw new AppError('userId مطلوب لإرسال الإشعار', 400, 'USER_ID_REQUIRED');
  }
  if (!body) {
    throw new AppError('محتوى الإشعار مطلوب', 400, 'NOTIFICATION_BODY_REQUIRED');
  }

  // ── 1. حفظ الإشعار في DB ─────────────────────────────────────
  const notification = await Notification.create({
    user:           actualUserId,
    type:           payload.type,
    title,
    body,
    itemId:         payload.itemId         ?? null,
    conversationId: payload.conversationId ?? null,
    actionUrl:      payload.actionUrl      ?? null,
    metadata: {
      ...(payload.metadata ?? {}),
      ...(payload.actionUrl ? { actionUrl: payload.actionUrl } : {}),
    },
  });

  // ── 2. Socket.io real-time emit ─────────────────────────────
  try {
    emitToUser(actualUserId, SOCKET_EVENTS.NOTIFICATION_NEW, {
      _id:            notification._id,
      user:           notification.user,
      type:           notification.type,
      title:          notification.title,
      body:           notification.body,
      itemId:         notification.itemId         ?? null,
      conversationId: notification.conversationId ?? null,
      actionUrl:      notification.actionUrl      ?? null,
      metadata:       notification.metadata       ?? null,
      isRead:         notification.isRead,
      createdAt:      notification.createdAt,
    });
  } catch (err) {
    console.error('[notifyUser Socket Error]:', err.message);
  }

  // ── 3. بريد احتياطي للإشعارات الحرجة فقط ────────────────────
  if (CRITICAL_NOTIFICATION_TYPES.includes(payload.type)) {
    if (userEmail) {
      try {
        const platformName = await getPlatformName();
        const { fireSendEmail } = require('./sendEmail');

        fireSendEmail({
          email:   userEmail,
          subject: title,
          message: `
            <div dir="rtl" style="font-family:sans-serif;line-height:1.8;color:#191c1d;max-width:560px;margin:auto;">
              <h2 style="color:#c0392b;margin-bottom:8px;">${title}</h2>
              <p style="margin:0 0 16px;">${body}</p>
              ${payload.actionUrl
                ? `<a href="${payload.actionUrl}"
                      style="display:inline-block;padding:10px 20px;background:#01696f;
                             color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
                       Anputation Application
                     </a>`
                : ''
              }
              <hr style="border:none;border-top:1px solid #edeeef;margin:20px 0;" />
              <p style="font-size:11px;color:#747775;">
                هذا إشعار إداري رسمي من منصة ${platformName}.
              </p>
            </div>
          `,
        }).catch((emailErr) =>
          console.error('[notifyUser Email Fallback] فشل الإرسال:', emailErr.message)
        );
      } catch (importErr) {
        console.warn('[notifyUser] تعذر تحميل sendEmail:', importErr.message);
      }
    } else {
      console.warn(
        `[notifyUser] ⚠️ إشعار حرج "${payload.type}" للمستخدم ${actualUserId}` +
        ` — لم يُرسل بريد: حقل email غير متوفر في payload أو user object.`
      );
    }
  }

  return notification;
}

notifyUser.CRITICAL_TYPES = CRITICAL_NOTIFICATION_TYPES;

module.exports = notifyUser;
