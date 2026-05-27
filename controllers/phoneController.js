// controllers/phoneController.js
// المسؤولية: استقبال طلبات التحقق من الهاتف وتفويضها للـ services
// لا منطق هنا — فقط validate → service → respond

const { createPhoneOtp, verifyPhoneOtp } = require('../services/phoneService');
const { sendOtpWhatsApp } = require('../integrations/whatsappService');

// ─── Helpers ──────────────────────────────────────────────────
// تحقق بسيط من صيغة رقم الهاتف الأردني
const PHONE_REGEX = /^(\+962|00962|0)?7[789]\d{7}$/;

// ─── POST /api/phone/send-otp ─────────────────────────────────
// يتطلب: requireAuth (Level 1 كافٍ)
// Body: { phone: "0791234567" }
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    // ✅ Validate
    if (!phone || !PHONE_REGEX.test(phone.trim())) {
      return res.status(400).json({
        msg:  'رقم الهاتف غير صالح — يجب أن يكون رقماً أردنياً (07x)',
        code: 'INVALID_PHONE',
      });
    }

    // ✅ لا نسمح لمن تحقق بالفعل بإعادة الطلب
    if (req.user.trustLevel >= 2) {
      return res.status(400).json({
        msg:  'حسابك محقق بالفعل ✅',
        code: 'ALREADY_VERIFIED',
      });
    }

    // ✅ أنشئ OTP واحفظه — phoneService يتحقق من Rate Limit داخلياً
    const { otp, phone: formattedPhone } = await createPhoneOtp(
      req.user.id,
      phone.trim()
    );

    // ✅ أرسل عبر WhatsApp — whatsappService يتعامل مع dev/prod
    await sendOtpWhatsApp(formattedPhone, otp);

    // ✅ لا نُعيد الـ OTP في الـ Response أبداً
    return res.status(200).json({
      msg: 'تم إرسال رمز التحقق إلى WhatsApp الخاص بك 📲',
    });

  } catch (err) {
    return res.status(err.status ?? 500).json({
      msg:  err.message ?? 'خطأ في الخادم',
      code: err.code    ?? 'SERVER_ERROR',
    });
  }
};

// ─── POST /api/phone/verify-otp ──────────────────────────────
// يتطلب: requireAuth (Level 1)
// Body: { otp: "123456" }
exports.verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;

    // ✅ Validate
    if (!otp || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        msg:  'الرمز يجب أن يتكون من 6 أرقام',
        code: 'INVALID_OTP_FORMAT',
      });
    }

    // ✅ لا نسمح لمن تحقق بالفعل
    if (req.user.trustLevel >= 2) {
      return res.status(400).json({
        msg:  'حسابك محقق بالفعل ✅',
        code: 'ALREADY_VERIFIED',
      });
    }

    // ✅ تحقق من الـ OTP — phoneService يمسحه فوراً بعد النجاح (single-use)
    await verifyPhoneOtp(req.user.id, otp);

    // ✅ النجاح — trustLevel أصبح 2 في DB
    // ⚠️ المستخدم يحتاج refresh للـ Access Token ليرى trustLevel=2 في الـ JWT
    return res.status(200).json({
      msg:              'تم التحقق بنجاح 🎉 يمكنك الآن حجز العناصر',
      requiresRefresh:  true,  // ← إشارة للـ Frontend لاستدعاء /refresh-token
    });

  } catch (err) {
    return res.status(err.status ?? 500).json({
      msg:  err.message ?? 'خطأ في الخادم',
      code: err.code    ?? 'SERVER_ERROR',
    });
  }
};