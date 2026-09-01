// utils/sendEmail.js
const SystemSettings = require('../models/SystemSettings');

type EmailOptions = {
  email: string;
  subject: string;
  message: string;
  replyTo?: string;
};

type BrevoEmailBody = {
  sender: { name: string; email: string };
  to: Array<{ email: string }>;
  subject: string;
  htmlContent: string;
  replyTo?: { email: string };
};

// ✅ جلب platformName من DB مع Cache
const getPlatformName = async () => {
  try {
    const settings = await SystemSettings.getCached();
    return settings?.platformName ?? 'عون';
  } catch {
    return 'عون'; // fallback آمن لو DB ما استجاب
  }
};

const sendEmail = async (options: EmailOptions) => {
  if (!process.env.BREVO_API_KEY) {
    console.warn('[sendEmail] BREVO_API_KEY غير مضبوط — تخطي إرسال الإيميل');
    return;
  }

  // ✅ اسم المُرسِل من DB وليس ENV
  const platformName = await getPlatformName();
  const senderName   = `منصة ${platformName} المجتمعية`;
  const senderEmail  = process.env.PLATFORM_EMAIL ?? 'aoun.help.center@gmail.com';

  try {
    const body: BrevoEmailBody = {
      sender:      { name: senderName, email: senderEmail },
      to:          [{ email: options.email }],
      subject:     options.subject,
      htmlContent: options.message,
    };

    if (options.replyTo) {
      body.replyTo = { email: options.replyTo };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: {
        'accept':       'application/json',
        'api-key':      process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errBody;
      try { errBody = await response.json(); } catch { errBody = {}; }
      console.error('[sendEmail] ❌ فشل إرسال الإيميل:', {
        status:  response.status,
        message: errBody?.message ?? response.statusText,
        to:      options.email,
        subject: options.subject,
      });
    } else {
      console.log(`[sendEmail] ✅ أُرسل بنجاح → ${options.email} | "${options.subject}"`);
    }
  } catch (error) {
    console.error('[sendEmail] 📧 Network/Parse Error:', {
      message: error.message,
      to:      options.email,
    });
  }
};

const fireSendEmail = (options) => sendEmail(options).catch((err) => {
  console.error('[fireSendEmail] unhandled error:', err.message);
});

module.exports = sendEmail;
module.exports.sendEmail     = sendEmail;
module.exports.fireSendEmail = fireSendEmail;
