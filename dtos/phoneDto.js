// dtos/phoneDto.js
// ✅ [FLOW2-FIX-08] يستورد من phoneUtils بدل تعريف PHONE_REGEX محلياً
const {
  JORDAN_PHONE_REGEX,
  normalizeJordanPhone,
} = require('../utils/phoneUtils');

/** تنسيق رقم الهاتف لصيغة دولية (+962xxxxxxxx) */
exports.normalizePhone = (raw) => normalizeJordanPhone(raw);

/** التحقق من صحة رقم هاتف أردني */
exports.validatePhone = (phone) => {
  if (!phone || !JORDAN_PHONE_REGEX.test(phone.trim())) {
    return { valid: false, msg: 'رقم الهاتف غير صالح — يجب أن يكون رقماً أردنياً (+9627XXXXXXX)' };
  }
  return { valid: true };
};

/** التحقق من صحة تنسيق الـ OTP */
exports.validateOtp = (otp) => {
  if (!otp || !/^\d{6}$/.test(otp)) {
    return { valid: false, msg: 'الرمز يجب أن يتكون من 6 أرقام' };
  }
  return { valid: true };
};

/** ما يُرجع للـ Frontend بعد إرسال OTP */
exports.toSendOtpResponse = () => ({
  msg: 'تم إرسال رمز التحقق إلى WhatsApp الخاص بك 📲',
});

/** ما يُرجع للـ Frontend بعد التحقق الناجح */
exports.toVerifyOtpResponse = () => ({
  msg:             'تم التحقق بنجاح 🎉 يمكنك الآن حجز العناصر',
  requiresRefresh: true,
});