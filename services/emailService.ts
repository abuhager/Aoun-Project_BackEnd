import axios from 'axios';
import SystemSettings from '../models/SystemSettings.js';
import { getAllowedOrigins } from '../config/cors.js';

type SendEmailInput = {
  to: string;
  subject: string;
  htmlContent: string;
  platformName: string;
  replyTo?: string;
};

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const getPlatformName = async () => {
  const settings = await SystemSettings.getCached();
  return settings?.platformName ?? 'عون';
};

const getClientOrigin = () => {
  const candidate = process.env.CLIENT_URL || getAllowedOrigins()[0];
  if (!candidate) throw new Error('[emailService] CLIENT_URL غير مضبوط');

  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('[emailService] CLIENT_URL يجب أن يستخدم http أو https');
  }
  return parsed.origin;
};

const send = async ({
  to,
  subject,
  htmlContent,
  platformName,
  replyTo,
}: SendEmailInput) => {
  if (!process.env.BREVO_API_KEY) {
    throw Object.assign(new Error('EMAIL_PROVIDER_NOT_CONFIGURED'), {
      code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
    });
  }

  const body: Record<string, unknown> = {
      sender: {
        name: `منصة ${platformName}`,
        email: process.env.SMTP_USER || process.env.PLATFORM_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent,
  };
  if (replyTo) body.replyTo = { email: replyTo };

  try {
    await axios.post(BREVO_URL, body, {
      timeout: 10_000,
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
    });
  } catch (error: unknown) {
    const responseStatus = typeof error === 'object'
      && error !== null
      && 'response' in error
      && typeof error.response === 'object'
      && error.response !== null
      && 'status' in error.response
      ? Number(error.response.status)
      : null;

    if (responseStatus && Number.isInteger(responseStatus)) {
      console.error('[emailService] فشل مزود البريد', { status: responseStatus });
      throw Object.assign(new Error('EMAIL_PROVIDER_REJECTED'), {
        code: `EMAIL_HTTP_${responseStatus}`,
      });
    }

    console.error('[emailService] تعذر الاتصال بخدمة البريد');
    throw Object.assign(new Error('EMAIL_PROVIDER_UNAVAILABLE'), {
      code: 'EMAIL_PROVIDER_UNAVAILABLE',
    });
  }
};

export const sendCustomEmail = async ({
  to,
  subject,
  htmlContent,
  replyTo,
}: Omit<SendEmailInput, 'platformName'>) => {
  const platformName = await getPlatformName();
  await send({ to, subject, htmlContent, platformName, replyTo });
};

export const sendVerificationEmail = async (
  to: string,
  otp: string | number,
  name = '',
  isStudent = false,
  expiryMinutes = 10
) => {
  const platformName = await getPlatformName();
  const safePlatform = escapeHtml(platformName);
  const safeName = escapeHtml(name);
  const safeOtp = escapeHtml(otp);

  const studentBadge = isStudent
    ? '<p style="color:#1a6b4a;font-weight:bold;">✅ تم التعرف على إيميلك الجامعي — مستوى الثقة 2</p>'
    : '';

  await send({
    to,
    platformName,
    subject: `تأكيد حسابك في منصة ${platformName} 📬`,
    htmlContent: `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <h2 style="color:#1a6b4a;">مرحباً ${safeName} 👋</h2>
        <p>استخدم الرمز التالي لتأكيد بريدك الإلكتروني في ${safePlatform}:</p>
        ${studentBadge}
        <div style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#1a6b4a;text-align:center;padding:20px;background:#f0faf5;border-radius:8px;margin:20px 0;">
          ${safeOtp}
        </div>
        <p style="color:#6b7280;font-size:13px;">⏱️ صالح لمدة <strong>${Number(expiryMinutes)} دقائق</strong> فقط.</p>
      </div>
    `,
  });
};

export const sendPasswordResetEmail = async (
  to: string,
  resetToken: string,
  name = '',
  expiryMinutes = 15
) => {
  const platformName = await getPlatformName();
  // الـ fragment لا يُرسل إلى Next.js أو proxy/access logs أو Referer.
  const resetUrl = `${getClientOrigin()}/reset-password#token=${encodeURIComponent(resetToken)}`;
  const safeName = escapeHtml(name);
  const safeResetUrl = escapeHtml(resetUrl);

  await send({
    to,
    platformName,
    subject: `إعادة تعيين كلمة المرور — منصة ${platformName} 🔐`,
    htmlContent: `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <h2 style="color:#b91c1c;">إعادة تعيين كلمة المرور</h2>
        <p>مرحباً ${safeName}، اضغط على الزر أدناه لإعادة تعيين كلمة مرورك:</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${safeResetUrl}" style="background:#b91c1c;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;display:inline-block;">
            إعادة تعيين كلمة المرور
          </a>
        </div>
        <p style="color:#6b7280;font-size:13px;">⏱️ الرابط صالح لمدة <strong>${Number(expiryMinutes)} دقيقة</strong> فقط.</p>
        <p style="color:#9ca3af;font-size:11px;word-break:break-all;">أو انسخ: ${safeResetUrl}</p>
      </div>
    `,
  });
};

export const sendRegistrationGuidanceEmail = async (
  to: string,
  name = ''
) => {
  const platformName = await getPlatformName();
  const safePlatform = escapeHtml(platformName);
  const safeName = escapeHtml(name);
  const loginUrl = escapeHtml(`${getClientOrigin()}/login`);

  await send({
    to,
    platformName,
    subject: `محاولة إنشاء حساب في منصة ${platformName}`,
    htmlContent: `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <h2 style="color:#1a6b4a;">مرحباً ${safeName}</h2>
        <p>وصلتنا محاولة إنشاء حساب باستخدام هذا البريد في ${safePlatform}.</p>
        <p>إذا كان لديك حساب بالفعل، استخدم صفحة تسجيل الدخول أو استعادة كلمة المرور. وإذا لم تكن أنت، يمكنك تجاهل هذه الرسالة.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${loginUrl}" style="background:#1a6b4a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">تسجيل الدخول</a>
        </div>
      </div>
    `,
  });
};

export { escapeHtml };

export { getClientOrigin };

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendRegistrationGuidanceEmail,
  sendCustomEmail,
  escapeHtml,
  getClientOrigin,
};
