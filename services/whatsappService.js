// services/whatsappService.js
// المسؤولية: إرسال OTP عبر WhatsApp Business API (Meta Cloud API)
// لا يولّد OTP — هذا مسؤولية phoneService.js

const axios = require('axios');

// ─── الثوابت من .env ──────────────────────────────────────────
const WA_API_URL  = process.env.WHATSAPP_API_URL;  // https://graph.facebook.com/v19.0/{phone_id}/messages
const WA_TOKEN    = process.env.WHATSAPP_TOKEN;    // Bearer token من Meta Business
const WA_ENABLED  = process.env.WHATSAPP_ENABLED !== 'false'; // false في dev → log فقط

// ─── تنسيق رقم الهاتف ─────────────────────────────────────────
// يحول: 0791234567 → 962791234567 (الأردن)
// يقبل: أرقام بادئها 00 أو + أو بدون مفتاح
function formatJordanPhone(phone) {
  const digits = phone.replace(/\D/g, ''); // احذف كل شيء غير رقم

  if (digits.startsWith('962'))  return digits;           // مفتاح الأردن موجود
  if (digits.startsWith('00962')) return digits.slice(2); // 00962 → 962
  if (digits.startsWith('0'))    return '962' + digits.slice(1); // 07x → 9627x
  return digits; // أعده كما هو إذا لم نتعرف عليه
}

// ─── إرسال رسالة WhatsApp ─────────────────────────────────────
async function sendOtpWhatsApp(phone, otp) {
  const formattedPhone = formatJordanPhone(phone);

  // ✅ Dev mode: طباعة فقط بدل إرسال حقيقي
  if (!WA_ENABLED) {
    console.log(`[WhatsApp DEV] → ${formattedPhone} | OTP: ${otp}`);
    return { success: true, dev: true };
  }

  // ✅ التحقق من الإعدادات قبل الإرسال
  if (!WA_API_URL || !WA_TOKEN) {
    throw new Error('[whatsappService] WHATSAPP_API_URL أو WHATSAPP_TOKEN غير مضبوطَين في .env');
  }

  try {
    const response = await axios.post(
      WA_API_URL,
      {
        messaging_product: 'whatsapp',
        to:                formattedPhone,
        type:              'template',
        template: {
          name:     'otp_verification',   // ← اسم الـ template المعتمد في Meta
          language: { code: 'ar' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: otp },
              ],
            },
            {
              // ✅ زر نسخ الرمز التلقائي (OTP Button في Meta)
              type:     'button',
              sub_type: 'url',
              index:    '0',
              parameters: [
                { type: 'text', text: otp },
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 8000, // 8 ثوانٍ timeout
      }
    );

    return { success: true, messageId: response.data?.messages?.[0]?.id };

  } catch (err) {
    // ✅ لا نكشف تفاصيل الخطأ الداخلي للـ controller
    const status  = err.response?.status;
    const waError = err.response?.data?.error?.message ?? err.message;
    console.error(`[whatsappService] فشل الإرسال إلى ${formattedPhone}: ${waError}`);

    throw Object.assign(
      new Error('فشل إرسال رمز التحقق عبر WhatsApp، حاول مرة أخرى'),
      { status: status ?? 502, code: 'WHATSAPP_SEND_FAILED' }
    );
  }
}

module.exports = { sendOtpWhatsApp, formatJordanPhone };