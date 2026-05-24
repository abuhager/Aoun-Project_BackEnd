// utils/sendEmail.js — ✅ FIXED: export موحّد + fire-and-forget
const sendEmail = async (options) => {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept':       'application/json',
        'api-key':      process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender:      { name: 'منصة عون المجتمعية', email: 'aoun.help.center@gmail.com' },
        to:          [{ email: options.email }],
        subject:     options.subject,
        htmlContent: options.message,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('❌ فشل إرسال الإيميل:', err);
    } else {
      console.log('✅ تم إرسال الإيميل بنجاح!');
    }
  } catch (error) {
    console.error('📧 Error in sendEmail utility:', error.message);
  }
};

// ✅ fire-and-forget — لا ينتظر النتيجة (للأداء)
const fireSendEmail = (options) => { sendEmail(options).catch(console.error); };

module.exports = sendEmail;
module.exports.sendEmail    = sendEmail;    // ← named export
module.exports.fireSendEmail = fireSendEmail; // ← named export