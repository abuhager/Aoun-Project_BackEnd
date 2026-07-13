// integrations/smsService.js
// المسؤولية: إرسال OTP عبر Twilio Verify API
// ✅ إصلاح: حذف customCode (غير مدعوم في Trial)
//    Twilio يولّد الرمز لحاله ويتحقق منه داخلياً عبر verificationChecks

const twilio = require('twilio');

// ─── Client ────────────────────────────────────────────────────
const getClient = () => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID أو TWILIO_AUTH_TOKEN غير مضبوط في .env');
  return twilio(sid, token);
};

// ─── Helper: تحويل الرقم إلى E.164 ───────────────────────────
const toE164 = (phone) => {
  let p = String(phone).replace(/[\s\-().]/g, '').trim();
  p = p.replace(/^\+|^00/, '');
  // 07x → 9627x (أرقام أردنية)
  if (/^07\d{8}$/.test(p)) p = '962' + p.slice(1);
  return '+' + p;
};

// ─── إرسال OTP عبر Twilio Verify ──────────────────────────────
// Twilio يولّد الرمز لحاله — لا نمرر customCode
exports.sendOtpWhatsApp = async (phone) => {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) throw new Error('TWILIO_VERIFY_SERVICE_SID غير مضبوط في .env');

  const client = getClient();
  const to     = toE164(phone);

  await client.verify.v2
    .services(serviceSid)
    .verifications.create({ to, channel: 'sms' });

  return { success: true, to };
};

// ─── التحقق من OTP عبر Twilio (بدل DB) ───────────────────────
// Twilio يحتفظ بالرمز داخلياً — نسأله عن صحة الكود
exports.checkOtpWhatsApp = async (phone, code) => {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) throw new Error('TWILIO_VERIFY_SERVICE_SID غير مضبوط في .env');

  const client = getClient();
  const to     = toE164(phone);

  const check = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to, code: String(code) });

  // check.status === 'approved' يعني الرمز صحيح
  return check.status === 'approved';
};
