import SystemSettings from '../models/SystemSettings.js';

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
      // Vendor responses may contain recipient details; log only the HTTP status.
      await response.body?.cancel();
      console.error('[sendEmail] ❌ فشل إرسال الإيميل:', {
        status:  response.status,
      });
    } else {
      await response.body?.cancel();
      if (process.env.NODE_ENV !== 'production') {
        console.info('[sendEmail] ✅ أُرسل البريد بنجاح');
      }
    }
  } catch {
    console.error('[sendEmail] تعذر الاتصال بخدمة البريد');
  }
};

const fireSendEmail = (options: EmailOptions): Promise<void> => sendEmail(options).catch(() => {
  console.error('[fireSendEmail] تعذر تجهيز رسالة البريد');
});

const emailClient = Object.assign(sendEmail, { sendEmail, fireSendEmail });

export default emailClient;

export { sendEmail };

export { fireSendEmail };
