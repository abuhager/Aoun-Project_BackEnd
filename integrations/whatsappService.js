// integrations/whatsappService.js
const axios          = require('axios');
const SystemSettings = require('../models/SystemSettings'); // ✅ إضافة
const AppError       = require('../utils/AppError');

const API_VERSION     = 'v20.0';
const BASE_URL        = `https://graph.facebook.com/${API_VERSION}`;

const getConfig = () => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_TOKEN;
  const configuredUrl = process.env.WHATSAPP_API_URL;
  let apiUrl = '';
  if (configuredUrl?.includes('{PHONE_NUMBER_ID}')) {
    apiUrl = phoneNumberId
      ? configuredUrl.replace('{PHONE_NUMBER_ID}', phoneNumberId)
      : '';
  } else if (configuredUrl) {
    apiUrl = configuredUrl;
  } else if (phoneNumberId) {
    apiUrl = `${BASE_URL}/${phoneNumberId}/messages`;
  }

  return {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    accessToken,
    apiUrl,
  };
};

// ✅ جلب platformName من DB مع Cache
const getPlatformName = async () => {
  try {
    const settings = await SystemSettings.getCached();
    return settings?.platformName ?? 'عون';
  } catch {
    return 'عون';
  }
};

// ── تنظيف الرقم ──────────────────────────────────────────────
const cleanPhone = (phone) => {
  let p = String(phone).replace(/[\s\-().]/g, '').trim();
  p = p.replace(/^\+|^00/, '');
  if (/^07\d{8}$/.test(p)) p = '962' + p.slice(1);
  return p;
};

// ── Retry Helper ─────────────────────────────────────────────
const withRetry = async (fn, retries = 2, delayMs = 500) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status && status >= 400 && status < 500) break;
      if (attempt < retries)
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
};

// ── إرسال رسالة نصية ─────────────────────────────────────────
const sendText = async (to, text) => {
  const { enabled, accessToken, apiUrl } = getConfig();
  if (!enabled) {
    return { success: false, reason: 'DISABLED' };
  }
  if (!apiUrl || !accessToken) {
    console.warn('[WhatsApp] متغيرات البيئة غير مضبوطة — تخطي الإرسال');
    return { success: false, reason: 'ENV_NOT_SET' };
  }

  const cleanedPhone = cleanPhone(to);
  if (!/^\d{7,15}$/.test(cleanedPhone)) {
    console.warn(`[WhatsApp] رقم هاتف غير صالح: "${to}" → "${cleanedPhone}"`);
    return { success: false, reason: 'INVALID_PHONE' };
  }

  const { data } = await withRetry(() =>
    axios.post(
      apiUrl,
      {
        messaging_product: 'whatsapp',
        to:   cleanedPhone,
        type: 'text',
        text: { body: text, preview_url: false },
      },
      {
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    )
  );

  return { success: true, messageId: data.messages?.[0]?.id };
};

// ── إرسال OTP ────────────────────────────────────────────────
exports.sendWhatsAppOtp = async (phone, otp) => {
  const platformName = await getPlatformName(); // ✅ من DB

  const message = [
    `🔐 *رمز التحقق الخاص بك في منصة ${platformName}:*`, // ✅ ديناميكي
    ``,
    `     *${otp}*`,
    ``,
    `⏱️ صالح لمدة 10 دقائق فقط.`,
    `⚠️ لا تشارك هذا الرمز مع أي أحد.`,
  ].join('\n');

  try {
    return await sendText(phone, message);
  } catch (err) {
    const apiErr = err.response?.data?.error;
    console.error('[WhatsApp OTP Error]', {
      code:    apiErr?.code    ?? 'UNKNOWN',
      message: apiErr?.message ?? err.message,
      phone:   cleanPhone(phone),
    });
    throw new AppError(
      apiErr?.message ?? 'فشل إرسال رسالة واتساب ❌',
      502,
      apiErr?.code ? `WA_${apiErr.code}` : 'WA_SEND_FAILED'
    );
  }
};

exports._private = { cleanPhone, getConfig };

// ── إشعار تأكيد التسليم (Non-blocking) ───────────────────────
exports.sendDeliveryConfirmation = async (phone, itemTitle, role) => {
  const platformName = await getPlatformName(); // ✅ من DB

  const messages = {
    recipient: `✅ تم تأكيد استلامك لـ *${itemTitle}* في منصة ${platformName}.\nشكراً لك على المشاركة 💚`,
    donor:     `🎉 تم تأكيد تسليم *${itemTitle}* بنجاح!\nيرجى تقييم المستلم في التطبيق ⭐`,
  };

  try {
    return await sendText(phone, messages[role] ?? messages.donor);
  } catch (err) {
    console.warn('[WhatsApp Delivery Notice] فشل إرسال إشعار التسليم:', err.message);
    return { success: false };
  }
};
