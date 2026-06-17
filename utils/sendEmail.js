// utils/sendEmail.js
// ✅ NJ-12 FIX: إضافة replyTo اختيارية + from name ديناميكي من SystemSettings
// ✅ NJ-13 FIX: تحسين تسجيل أخطاء Brevo — يُسجَّل status + message كاملاً
// ✅ NJ-14 FIX: fireSendEmail تُعيد Promise<void> (لا undefined)
//              حتى يمكن للمستدعي إضافة .catch() أو await إذا أراد

const sendEmail = async (options) => {
  if (!process.env.BREVO_API_KEY) {
    console.warn('[sendEmail] BREVO_API_KEY غير مضبوط — تخطي إرسال الإيميل');
    return;
  }

  // ✅ NJ-12: اسم المُرسِل ديناميكي — يقرأ من ENV أو يستخدم الافتراضي
  const senderName  = process.env.PLATFORM_NAME ?? 'منصة عون المجتمعية';
  const senderEmail = process.env.PLATFORM_EMAIL ?? 'aoun.help.center@gmail.com';

  try {
    const body = {
      sender:      { name: senderName, email: senderEmail },
      to:          [{ email: options.email }],
      subject:     options.subject,
      htmlContent: options.message,
    };

    // ✅ NJ-12: replyTo اختيارية — مفيدة للردود على بريد الدعم
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
      // ✅ NJ-13 FIX: تسجيل تفاصيل الخطأ الكاملة من Brevo
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

// ✅ NJ-14 FIX: fireSendEmail تُعيد Promise<void> بشكل صريح
const fireSendEmail = (options) => sendEmail(options).catch((err) => {
  console.error('[fireSendEmail] unhandled error:', err.message);
});

module.exports = sendEmail;
module.exports.sendEmail     = sendEmail;
module.exports.fireSendEmail = fireSendEmail;
