// integrations/smsService.js
// المسؤولية: إرسال OTP عبر Twilio Verify API
// يستبدل whatsappService.js المعطّل مؤقتاً
// لا يتغير أي شيء في phoneService.js أو phoneController.js سوى سطر الـ import

const twilio = require('twilio');

// ─── Client ───────────────────────────────────────────────────
const getClient = () => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID أو TWILIO_AUTH_TOKEN غير مضبوط في .env');
  }

  return twilio(sid, token);
};

// ─── Helper: تحويل الرقم الأردني إلى E.164 ───────────────────
const toE164 = (phone) => {
  let p = String(phone).replace(/[\s\-().]/g, '').trim();
  // أزل + أو 00 من البداية
  p = p.replace(/^\+|^00/, '');
  // 07x → 9627x
  if (/^07\d{8}$/.test(p)) p = '962' + p.slice(1);
  return '+' + p;
};

// ─── POST /api/phone/send-otp ─────────────────────────────────
// نفس الاسم الذي يستورده phoneController.js — لا تغيير في الـ controller
exports.sendOtpWhatsApp = async (phone, otp) => {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!serviceSid) {
    throw new Error('TWILIO_VERIFY_SERVICE_SID غير مضبوط في .env');
  }

  const client = getClient();

  await client.verify.v2
    .services(serviceSid)
    .verifications.create({
      to:         toE164(phone),
      channel:    'sms',
      // customCode يضمن أن الـ OTP المرسل = OTP المحفوظ في DB
      customCode: String(otp),
    });

  return { success: true };
};
