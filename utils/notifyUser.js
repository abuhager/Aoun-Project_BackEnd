// utils/notifyUser.js
const Notification = require('../models/Notification');
const AppError = require('./AppError');

async function notifyUser(userId, payload) {
  // استخلاص المعرّف الفعلي للمستخدم سواء تم تمرير كائن مستخدم كامل أو ID مجرد
  const actualUserId = userId && typeof userId === 'object' ? userId._id : userId;

  if (!actualUserId) {
    throw new AppError('userId مطلوب لإرسال الإشعار', 400, 'USER_ID_REQUIRED');
  }

  // 1. تسجيل الإشعار في قاعدة البيانات
  const notification = await Notification.create({
    user: actualUserId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    itemId: payload.itemId ?? null,
    conversationId: payload.conversationId ?? null,
    metadata: payload.metadata ?? null,
  });

  // 2. بث الإشعار الفوري عبر الـ Socket للاتصالات الحية
  try {
    const { getIO } = require('../socket/socketHandler');

    getIO()
      .to(`user_${actualUserId}`)
      .emit('notification:new', {
        _id: notification._id,
        user: notification.user,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        itemId: notification.itemId ?? null,
        conversationId: notification.conversationId ?? null,
        metadata: notification.metadata ?? null,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
      });
  } catch (err) {
    console.warn('[notifyUser] Socket emission skipped:', err.message);
  }

  // ✅ 3. منطق الأمان البنيوي المضاف: إرسال بريد إلكتروني احتياطي للحالات الحرجة
  const CRITICAL_TYPES = ['admin_ban', 'admin_warning'];
  
  if (CRITICAL_TYPES.includes(payload.type)) {
    // محاولة استخراج البريد الإلكتروني ذكياً من الـ payload أو من كائن الـ user الممرر كبارامتر أول
    const targetEmail = payload.email || (userId && typeof userId === 'object' ? userId.email : null);

    if (targetEmail) {
      try {
        // الاستيراد الديناميكي لمنع أي مشاكل تعارض أو تعليق دائري أثناء الـ Bootstrap
        const { fireSendEmail } = require('./sendEmail'); 
        
        fireSendEmail({
          email: targetEmail,
          subject: payload.title,
          message: `
            <div dir="rtl" style="font-family: sans-serif; line-height: 1.6; color: #191c1d;">
              <h2 style="color: #c0392b;">${payload.title}</h2>
              <p>${payload.body}</p>
              <hr style="border: none; border-top: 1px solid #edeeef; margin: 20px 0;" />
              <p style="font-size: 11px; color: #747775;">هذا إشعار إداري رسمي من منصة عون.</p>
            </div>
          `,
        }).catch((emailErr) => 
          console.error('[notifyUser Email Fallback] فشل إرسال البريد الإلكتروني التلقائي:', emailErr.message)
        );
      } catch (importErr) {
        console.warn('[notifyUser] تعذر تحميل وحدة sendEmail لاستخدام الـ Fallback:', importErr.message);
      }
    } else {
      console.warn(`[notifyUser] إشعار حرج من نوع "${payload.type}" لم يرسل له إيميل لعدم توفر حقل البريد الإلكتروني في حزمة البيانات.`);
    }
  }

  return notification;
}

module.exports = notifyUser;