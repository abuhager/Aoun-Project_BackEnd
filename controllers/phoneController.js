// controllers/phoneController.js
// المسؤولية: استقبال طلبات التحقق من الهاتف وتفويضها للـ services
// ✅ إصلاح: createPhoneOtp لا يُعيد otp بعد الآن — Twilio يدير الرمز

const { createPhoneOtp, verifyPhoneOtp } = require('../services/phoneService');
const { sendOtpWhatsApp }               = require('../integrations/smsService');

// ─── Helpers ─────────────────────────────────────────────────
// ⚠️ DEV: يقبل أي رقم دولي — غيّره لأردني فقط في Production
// PROD: /^(\+962|00962|0)?7[789]\d{7}$/
const IS_DEV      = process.env.NODE_ENV !== 'production';
const PHONE_REGEX = IS_DEV
  ? /^[+]?[\d\s\-().]{7,15}$/
  : /^(\+962|00962|0)?7[789]\d{7}$/;

// ─── POST /api/phone/send-otp ─────────────────────────────────
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || !PHONE_REGEX.test(phone.trim())) {
      return res.status(400).json({
        msg:  IS_DEV ? 'رقم الهاتف غير صالح' : 'رقم الهاتف غير صالح — يجب أن يكون رقماً أردنياً (07x)',
        code: 'INVALID_PHONE',
      });
    }

    if (req.user.trustLevel >= 2) {
      return res.status(400).json({ msg: 'حسابك محقق بالفعل ✅', code: 'ALREADY_VERIFIED' });
    }

    // جهّز Rate Limit + احفظ الرقم في DB
    const { phone: formattedPhone } = await createPhoneOtp(req.user.id, phone.trim());

    // أرسل عبر Twilio Verify (هو يولّد الرمز)
    await sendOtpWhatsApp(formattedPhone);

    return res.status(200).json({
      msg: 'تم إرسال رمز التحقق إلى هاتفك عبر الرسائل النصية 📲',
    });

  } catch (err) {
    return res.status(err.status ?? 500).json({
      msg:  err.message ?? 'خطأ في الخادم',
      code: err.code    ?? 'SERVER_ERROR',
    });
  }
};

// ─── POST /api/phone/verify-otp ──────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;

    if (!otp || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ msg: 'الرمز يجب أن يتكون من 6 أرقام', code: 'INVALID_OTP_FORMAT' });
    }

    if (req.user.trustLevel >= 2) {
      return res.status(400).json({ msg: 'حسابك محقق بالفعل ✅', code: 'ALREADY_VERIFIED' });
    }

    await verifyPhoneOtp(req.user.id, otp);

    return res.status(200).json({
      msg:             'تم التحقق بنجاح 🎉 يمكنك الآن حجز العناصر',
      requiresRefresh: true,
    });

  } catch (err) {
    return res.status(err.status ?? 500).json({
      msg:  err.message ?? 'خطأ في الخادم',
      code: err.code    ?? 'SERVER_ERROR',
    });
  }
};
