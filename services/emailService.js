// services/emailService.js
const axios          = require('axios');
const SystemSettings = require('../models/SystemSettings');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

// ── دالة مساعدة: تجلب platformName من DB (مع Cache) ────────────
const getPlatformName = async () => {
  const settings = await SystemSettings.getCached();
  return settings?.platformName ?? 'عون';
};

// ── دالة مساعدة داخلية ───────────────────────────────────────
const _send = async ({ to, subject, htmlContent, platformName }) => {
  await axios.post(
    BREVO_URL,
    {
      sender: {
        name:  `منصة ${platformName}`,
        email: process.env.SMTP_USER || 'aoun.help.center@gmail.com',
      },
      to:          [{ email: to }],
      subject,
      htmlContent,
    },
    {
      headers: {
        'api-key':      process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
};

// ─────────────────────────────────────────────────────────────
// 1. إيميل تأكيد الحساب (OTP)
// ─────────────────────────────────────────────────────────────
exports.sendVerificationEmail = async (to, otp, name = '', isStudent = false) => {
  const platformName = await getPlatformName(); // ✅ من DB

  const studentBadge = isStudent
    ? `<p style="color:#1a6b4a;font-weight:bold;">✅ تم التعرف على إيميلك الجامعي — مستوى الثقة 2</p>`
    : '';

  await _send({
    to,
    platformName,
    subject: `تأكيد حسابك في منصة ${platformName} 📬`,
    htmlContent: `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;
                            border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <h2 style="color:#1a6b4a;">مرحباً ${name} 👋</h2>
        <p>استخدم الرمز التالي لتأكيد بريدك الإلكتروني:</p>
        ${studentBadge}
        <div style="font-size:40px;font-weight:bold;letter-spacing:10px;
                    color:#1a6b4a;text-align:center;padding:20px;
                    background:#f0faf5;border-radius:8px;margin:20px 0;">
          ${otp}
        </div>
        <p style="color:#6b7280;font-size:13px;">
          ⏱️ صالح لمدة <strong>10 دقائق</strong> فقط.
        </p>
      </div>
    `,
  });
};

// ─────────────────────────────────────────────────────────────
// 2. إيميل إعادة تعيين كلمة المرور
// ─────────────────────────────────────────────────────────────
exports.sendResetPasswordEmail = async (to, _resetToken, name = '', resetUrl) => {
  const platformName = await getPlatformName(); // ✅ من DB

  await _send({
    to,
    platformName,
    subject: `إعادة تعيين كلمة المرور — منصة ${platformName} 🔐`,
    htmlContent: `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;
                            border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <h2 style="color:#b91c1c;">إعادة تعيين كلمة المرور</h2>
        <p>مرحباً ${name}، اضغط على الزر أدناه لإعادة تعيين كلمة مرورك:</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${resetUrl}"
             style="background:#b91c1c;color:#fff;padding:14px 32px;
                    border-radius:8px;text-decoration:none;font-size:16px;
                    font-weight:bold;display:inline-block;">
            إعادة تعيين كلمة المرور
          </a>
        </div>
        <p style="color:#6b7280;font-size:13px;">
          ⏱️ الرابط صالح لمدة <strong>15 دقيقة</strong> فقط.
        </p>
        <p style="color:#9ca3af;font-size:11px;word-break:break-all;">
          أو انسخ: ${resetUrl}
        </p>
      </div>
    `,
  });
};