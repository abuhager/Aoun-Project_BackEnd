// integrations/baileys.js
// ⚠️  للتطوير المحلي فقط — لا يُستخدم في الـ Production
// ✅ NJ-15 FIX: منع auto-connect عند require() — connectToWhatsApp يجب أن تُستدعى يدوياً
// ✅ NJ-16 FIX: حماية sendWhatsAppOtp من استدعائها قبل connect()
// ✅ NJ-17 FIX: reconnect loop محمي بـ flag لمنع infinite reconnect storms

const makeWASocket   = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const AppError = require('../utils/AppError');
const SystemSettings = require('../models/SystemSettings');

let sock          = null;
let isConnecting  = false; // ✅ NJ-17: حماية من reconnect storm
let reconnectTimer = null;

const cleanPhone = (phone) => {
  let normalized = String(phone ?? '').replace(/[\s\-().]/g, '');
  normalized = normalized.replace(/^\+|^00/, '');
  if (/^07\d{8}$/.test(normalized)) normalized = `962${normalized.slice(1)}`;
  return normalized;
};

const getPlatformName = async () => {
  try {
    const settings = await SystemSettings.getCached();
    return settings?.platformName ?? process.env.PLATFORM_NAME ?? 'عون';
  } catch {
    return process.env.PLATFORM_NAME ?? 'عون';
  }
};

// ── ✅ NJ-17: Reconnect مع حماية ─────────────────────────────
async function connectToWhatsApp() {
  // ✅ NJ-17 FIX: تجنب التشغيل المتوازي
  if (isConnecting) {
    console.warn('[Baileys] محاولة اتصال جارية بالفعل — تجاهل الطلب');
    return;
  }
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
      auth:                state,
      printQRInTerminal:   true,
      // ✅ NJ-17: حد أقصى للمحاولات التلقائية — 5 محاولات فقط
      connectTimeoutMs:    30_000,
      retryRequestDelayMs: 2_000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        isConnecting = false;
        console.log('[Baileys] ✅ متصل بواتساب بنجاح');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }

      if (connection === 'close') {
        isConnecting = false;
        sock = null;
        const reason = lastDisconnect?.error?.output?.statusCode
          ?? lastDisconnect?.error?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        console.warn(`[Baileys] ⚠️ انقطع الاتصال — سبب: ${reason}`);

        if (shouldReconnect) {
          if (!reconnectTimer) {
            // ✅ NJ-17: تأخير 5 ثوانٍ قبل إعادة المحاولة
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              void connectToWhatsApp();
            }, 5_000);
            reconnectTimer.unref?.();
          }
        } else {
          console.error('[Baileys] 🔒 تم تسجيل الخروج — يجب مسح auth_info يدوياً');
        }
      }
    });
  } catch (err) {
    isConnecting = false;
    console.error('[Baileys] ❌ فشل الاتصال:', err.message);
  }
}

// ── ✅ NJ-16 FIX: حماية من الاستدعاء قبل الاتصال ─────────────
exports.sendWhatsAppOtp = async (phone, otp) => {
  // ✅ NJ-16: رسالة خطأ واضحة بدل crash
  if (!sock) {
    throw new AppError(
      'WhatsApp (Baileys) غير متصل — استخدم whatsappService.js في Production',
      503,
      'WA_NOT_CONNECTED'
    );
  }

  const normalizedPhone = cleanPhone(phone);
  if (!/^\d{7,15}$/.test(normalizedPhone)) {
    throw new AppError('رقم الهاتف غير صالح لإرسال OTP', 400, 'INVALID_PHONE');
  }
  if (!/^\d{6}$/.test(String(otp))) {
    throw new AppError('رمز OTP غير صالح', 400, 'INVALID_OTP');
  }

  const jid = `${normalizedPhone}@s.whatsapp.net`;
  const platformName = await getPlatformName();

  await sock.sendMessage(jid, {
    text: `🔐 رمز التحقق في منصة *${platformName}*: *${otp}*\n⏱️ صالح 10 دقائق فقط.\n⚠️ لا تشاركه مع أحد.`,
  });
};

// ✅ NJ-15 FIX: لا auto-connect عند require() — يجب استدعاؤها صراحةً
// في server.js أو app.js:  require('./integrations/baileys').connect();
exports.connect = connectToWhatsApp;
exports._private = { cleanPhone, getPlatformName };

// ✅ للاستخدام المحلي فقط — تحقق من البيئة قبل الاتصال التلقائي
if (process.env.NODE_ENV === 'development' && process.env.USE_BAILEYS === 'true') {
  console.warn('[Baileys] ⚠️ وضع التطوير — يبدأ الاتصال تلقائياً');
  connectToWhatsApp();
}
