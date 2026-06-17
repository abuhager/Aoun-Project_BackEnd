// utils/notifyUser.js
// ✅ NJ-05 FIX: إضافة حقل metadata.actionUrl لدعم deep-link في الإشعار
// ✅ NJ-06 FIX: استخدام getIO()?.to() — لا يرمي خطأً إذا لم يُهيَّأ الـ Socket بعد
// ✅ NJ-07 FIX: CRITICAL_TYPES الآن مقروءة من ملف ثوابت مركزية — لا تكرار
// ✅ NJ-08 FIX: تحسين قراءة البريد من user object أو payload بترتيب واضح

const Notification = require('../models/Notification');
const AppError     = require('./AppError');

// ✅ NJ-07: أنواع الإشعارات الحرجة — مكان واحد للتعديل
const CRITICAL_NOTIFICATION_TYPES = Object.freeze([
  'admin_ban',
  'admin_warning',
  'account_suspended',
]);

/**
 * ترسل إشعاراً للمستخدم عبر:
 * 1. تسجيل في قاعدة البيانات (Notification model)
 * 2. Socket.io real-time emit لغرفة المستخدم
 * 3. بريد إلكتروني احتياطي للإشعارات الحرجة فقط
 *
 * @param {string|object} userId - ID المستخدم أو كائن User الكامل
 * @param {object} payload       - بيانات الإشعار
 * @returns {Promise<Notification>}
 */
async function notifyUser(userId, payload) {
  // ✅ NJ-08: استخلاص الـ ID والبريد بشكل موحّد
  const isObject    = userId && typeof userId === 'object';
  const actualUserId = isObject ? userId._id : userId;
  const userEmail    = payload.email ?? (isObject ? userId.email : null);

  if (!actualUserId) {
    throw new AppError('userId مطلوب لإرسال الإشعار', 400, 'USER_ID_REQUIRED');
  }

  // ── 1. حفظ الإشعار في DB ─────────────────────────────────────
  const notification = await Notification.create({
    user:           actualUserId,
    type:           payload.type,
    title:          payload.title,
    body:           payload.body,
    itemId:         payload.itemId         ?? null,
    conversationId: payload.conversationId ?? null,
    // ✅ NJ-05: دعم actionUrl لتوجيه المستخدم عند الضغط على الإشعار
    metadata: {
      ...(payload.metadata ?? {}),
      ...(payload.actionUrl ? { actionUrl: payload.actionUrl } : {}),
    },
  });

  // ── 2. Socket.io real-time emit ──────────────────────────────
  try {
    const { getIO } = require('../socket/socketHandler');
    // ✅ NJ-06: getIO()? — لا يرمي خطأً إذا لم يُهيَّأ بعد (مثلاً في unit tests)
    getIO()
      ?.to(`user_${actualUserId}`)
      ?.emit('notification:new', {
        _id:            notification._id,
        user:           notification.user,
        type:           notification.type,
        title:          notification.title,
        body:           notification.body,
        itemId:         notification.itemId         ?? null,
        conversationId: notification.conversationId ?? null,
        metadata:       notification.metadata       ?? null,
        isRead:         notification.isRead,
        createdAt:      notification.createdAt,
      });
  } catch (err) {
    // Socket فشل — لا يوقف العملية
    console.warn('[notifyUser] Socket emission skipped:', err.message);
  }

  // ── 3. بريد احتياطي للإشعارات الحرجة فقط ────────────────────
  // ✅ NJ-07: CRITICAL_NOTIFICATION_TYPES من ثابت موحّد
  if (CRITICAL_NOTIFICATION_TYPES.includes(payload.type)) {
    if (userEmail) {
      try {
        const { fireSendEmail } = require('./sendEmail');
        fireSendEmail({
          email:   userEmail,
          subject: payload.title,
          message: `
            <div dir="rtl" style="font-family: sans-serif; line-height: 1.8; color: #191c1d; max-width: 560px; margin: auto;">
              <h2 style="color: #c0392b; margin-bottom: 8px;">${payload.title}</h2>
              <p style="margin: 0 0 16px;">${payload.body}</p>
              ${payload.actionUrl
                ? `<a href="${payload.actionUrl}"
                      style="display:inline-block; padding:10px 20px; background:#01696f;
                             color:#fff; border-radius:8px; text-decoration:none; font-weight:bold;">
                      الانتقال للتطبيق
                   </a>`
                : ''
              }
              <hr style="border:none; border-top:1px solid #edeeef; margin:20px 0;" />
              <p style="font-size:11px; color:#747775;">
                هذا إشعار إداري رسمي من منصة عون.
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
      // ✅ NJ-08: تحذير واضح إذا لم يتوفر البريد لإشعار حرج
      console.warn(
        `[notifyUser] ⚠️ إشعار حرج "${payload.type}" للمستخدم ${actualUserId}` +
        ` — لم يُرسل بريد: حقل email غير متوفر في payload أو user object.`
      );
    }
  }

  return notification;
}

// تصدير ثوابت الأنواع الحرجة لاستخدامها في أماكن أخرى بدون تكرار
notifyUser.CRITICAL_TYPES = CRITICAL_NOTIFICATION_TYPES;

module.exports = notifyUser;
