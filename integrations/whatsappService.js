// integrations/whatsappService.js
// ✅ Meta WhatsApp Cloud API — Free Tier (1,000 رسالة/شهر مجاناً)
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const axios = require('axios');

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_TOKEN;
const API_VERSION     = 'v20.0';
const BASE_URL        = `https://graph.facebook.com/${API_VERSION}`;

// ── تنظيف رقم الهاتف (دولي بدون + أو 00) ─────────────────────
const cleanPhone = (phone) =>
  String(phone).replace(/^\+|^00|\s|-/g, '').trim();

// ── إرسال رسالة نصية ─────────────────────────────────────────
const sendText = async (to, text) => {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.warn('[WhatsApp] متغيرات البيئة غير مضبوطة — تخطي الإرسال');
    return { success: false, reason: 'ENV_NOT_SET' };
  }

  const { data } = await axios.post(
    `${BASE_URL}/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to:   cleanPhone(to),
      type: 'text',
      text: { body: text, preview_url: false },
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    }
  );

  return { success: true, messageId: data.messages?.[0]?.id };
};

// ── إرسال OTP ─────────────────────────────────────────────────
exports.sendWhatsAppOtp = async (phone, otp) => {
  const message = [
    `🔐 *رمز التحقق الخاص بك في منصة عون:*`,
    ``,
    `     *${otp}*`,
    ``,
    `⏱️ صالح لمدة 10 دقائق فقط.`,
    `⚠️ لا تشارك هذا الرمز مع أي أحد.`,
  ].join('\n');

  try {
    return await sendText(phone, message);
  } catch (err) {
    const apiErr = err.response?.data?.error;
    console.error('[WhatsApp OTP Error]', apiErr ?? err.message);

    throw Object.assign(
      new Error(apiErr?.message ?? 'فشل إرسال رسالة واتساب ❌'),
      { status: 502, code: apiErr?.code ?? 'WA_SEND_FAILED' }
    );
  }
};

// ── إرسال إشعار تأكيد التسليم ─────────────────────────────────
exports.sendDeliveryConfirmation = async (phone, itemTitle, role) => {
  const messages = {
    recipient: `✅ تم تأكيد استلامك لـ *${itemTitle}* في منصة عون.\nشكراً لك على المشاركة 💚`,
    donor:     `🎉 تم تأكيد تسليم *${itemTitle}* بنجاح!\nيرجى تقييم المستلم في التطبيق ⭐`,
  };

  try {
    return await sendText(phone, messages[role] ?? messages.donor);
  } catch (err) {
    console.warn('[WhatsApp Delivery Notice]', err.message);
    // لا ترفع الخطأ — هذا إشعار غير إلزامي
    return { success: false };
  }
};
