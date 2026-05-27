// dtos/phoneDto.js
// يُنظّم بيانات التحقق من رقم الهاتف

const PHONE_REGEX = /^(\+962|00962|0)?7[789]\d{7}$/;

/** تنسيق رقم الهاتف لصيغة دولية (+962xxxxxxxx) */
exports.normalizePhone = (raw) => {
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (cleaned.startsWith('+962')) return cleaned;
  if (cleaned.startsWith('00962')) return '+962' + cleaned.slice(5);
  if (cleaned.startsWith('0'))     return '+962' + cleaned.slice(1);
  return '+962' + cleaned;
};

/** التحقق من صحة رقم هاتف أردني */
exports.validatePhone = (phone) => {
  if (!phone || !PHONE_REGEX.test(phone.trim())) {
    return { valid: false, msg: 'رقم الهاتف غير صالح — يجب أن يكون رقماً أردنياً (07x)' };
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