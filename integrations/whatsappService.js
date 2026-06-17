// integrations/whatsappService.js
// ✅ NJ-01 FIX: حماية من حالة الـ Race — إضافة retry مع exponential backoff
// ✅ NJ-02 FIX: cleanPhone يدعم الآن أرقام أردنية محلية (07x) → يحوّلها إلى (9627x)
// ✅ NJ-03 FIX: timeout محمي + أخطاء HTTP الكاملة تُسجَّل بوضوح
// ✅ NJ-04 FIX: sendDeliveryConfirmation لا ترفع خطأ (non-blocking) — تم التأكيد

const axios = require('axios');

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_TOKEN;
const API_VERSION     = 'v20.0';
const BASE_URL        = `https://graph.facebook.com/${API_VERSION}`;

// ══════════════════════════════════════════════════════════════
// ✅ NJ-02 FIX: تنظيف وتوحيد صيغة الرقم الدولي
// يدعم: +9627x, 009627x, 07x (أردني محلي), 9627x
// ══════════════════════════════════════════════════════════════
const cleanPhone = (phone) => {
  let p = String(phone).replace(/[\s\-().]/g, '').trim();

  // إزالة علامة + أو 00 في البداية
  p = p.replace(/^\+|^00/, '');

  // ✅ NJ-02: تحويل الأرقام الأردنية المحلية 07xxxxxxxx → 9627xxxxxxxx
  if (/^07\d{8}$/.test(p)) {
    p = '962' + p.slice(1); // 07... → 9627...
  }

  return p;
};

// ══════════════════════════════════════════════════════════════
// ✅ NJ-01 FIX: Retry Helper مع Exponential Backoff
// ══════════════════════════════════════════════════════════════
const withRetry = async (fn, retries = 2, delayMs = 500) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // لا نعيد المحاولة على أخطاء 4xx (طلب خاطئ) — فقط 5xx أو network errors
      const status = err.response?.status;
      if (status && status >= 400 && status < 500) break;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
};

// ══════════════════════════════════════════════════════════════
// ✅ NJ-03 FIX: إرسال رسالة نصية مع حماية كاملة
// ══════════════════════════════════════════════════════════════
const sendText = async (to, text) => {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.warn('[WhatsApp] متغيرات البيئة غير مضبوطة — تخطي الإرسال');
    return { success: false, reason: 'ENV_NOT_SET' };
  }

  const cleanedPhone = cleanPhone(to);

  // ✅ NJ-02: التحقق من صيغة الرقم بعد التنظيف
  if (!/^\d{7,15}$/.test(cleanedPhone)) {
    console.warn(`[WhatsApp] رقم هاتف غير صالح: "${to}" → "${cleanedPhone}"`);
    return { success: false, reason: 'INVALID_PHONE' };
  }

  // ✅ NJ-01: استخدام withRetry
  const { data } = await withRetry(() =>
    axios.post(
      `${BASE_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to:   cleanedPhone,
        type: 'text',
        text: { body: text, preview_url: false },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        // ✅ NJ-03 FIX: timeout واضح — لا يعلق إلى الأبد
        timeout: 10_000,
      }
    )
  );

  return { success: true, messageId: data.messages?.[0]?.id };
};

// ══════════════════════════════════════════════════════════════
// إرسال OTP عبر واتساب
// ══════════════════════════════════════════════════════════════
exports.sendWhatsAppOtp = async (phone, otp) => {
  const message = [
    `🔐 *رمز التحقق الخاص بك في منصة عون:*`,
    ``,
    `     *${otp}*`,
    ``,
    `⏱️ صالح لمدة 10 دقائق فقط.`,
    `⚠️ لا تشارك هذا الرمز مع أي أحد.`,
  ].join('\n');

  try {
    return await sendText(phone, message);
  } catch (err) {
    // ✅ NJ-03 FIX: تسجيل تفاصيل الخطأ كاملةً
    const apiErr = err.response?.data?.error;
    console.error('[WhatsApp OTP Error]', {
      code:    apiErr?.code    ?? 'UNKNOWN',
      message: apiErr?.message ?? err.message,
      phone:   cleanPhone(phone),
    });

    throw Object.assign(
      new Error(apiErr?.message ?? 'فشل إرسال رسالة واتساب ❌'),
      { status: 502, code: apiErr?.code ?? 'WA_SEND_FAILED' }
    );
  }
};

// ══════════════════════════════════════════════════════════════
// ✅ NJ-04 FIX: إشعار تأكيد التسليم — Non-blocking بشكل صريح
// لا ترفع خطأً أبداً — فشلها لا يوقف flow التسليم
// ══════════════════════════════════════════════════════════════
exports.sendDeliveryConfirmation = async (phone, itemTitle, role) => {
  const messages = {
    recipient: `✅ تم تأكيد استلامك لـ *${itemTitle}* في منصة عون.\nشكراً لك على المشاركة 💚`,
    donor:     `🎉 تم تأكيد تسليم *${itemTitle}* بنجاح!\nيرجى تقييم المستلم في التطبيق ⭐`,
  };

  try {
    return await sendText(phone, messages[role] ?? messages.donor);
  } catch (err) {
    // ✅ NJ-04: تسجيل التحذير لكن لا رفع — هذا إشعار اختياري
    console.warn('[WhatsApp Delivery Notice] فشل إرسال إشعار التسليم:', err.message);
    return { success: false };
  }
};
