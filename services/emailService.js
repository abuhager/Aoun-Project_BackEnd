const axios = require('axios');

const SystemSettings = require('../models/SystemSettings');
const { getAllowedOrigins } = require('../config/cors');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const escapeHtml = (value) => String(value ?? '')
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

const send = async ({ to, subject, htmlContent, platformName }) => {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('[emailService] BREVO_API_KEY غير مضبوط');
  }

  await axios.post(
    BREVO_URL,
    {
      sender: {
        name: `منصة ${platformName}`,
        email: process.env.SMTP_USER || process.env.PLATFORM_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent,
    },
    {
      timeout: 10_000,
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
};

exports.sendVerificationEmail = async (
  to,
  otp,
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

exports.sendPasswordResetEmail = async (
  to,
  resetToken,
  name = '',
  expiryMinutes = 15
) => {
  const platformName = await getPlatformName();
  const resetUrl = `${getClientOrigin()}/reset-password/${encodeURIComponent(resetToken)}`;
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

exports.escapeHtml = escapeHtml;
exports.getClientOrigin = getClientOrigin;
