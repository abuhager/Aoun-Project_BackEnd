// dtos/phoneDto.js
// ✅ [FLOW2-FIX-08] يستورد من phoneUtils بدل تعريف PHONE_REGEX محلياً
const {
  normalizeJordanPhone,
} = require('../utils/phoneUtils');

/** تنسيق رقم الهاتف لصيغة دولية (+962xxxxxxxx) */
exports.normalizePhone = (raw) => normalizeJordanPhone(raw);

/** ما يُرجع للـ Frontend بعد إرسال OTP */
exports.toSendOtpResponse = () => ({
  msg: 'تم إرسال رمز التحقق إلى WhatsApp الخاص بك 📲',
});

/** ما يُرجع للـ Frontend بعد التحقق الناجح */
exports.toVerifyOtpResponse = () => ({
  msg:             'تم التحقق بنجاح 🎉 يمكنك الآن حجز العناصر',
  requiresRefresh: true,
});
