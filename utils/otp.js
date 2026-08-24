// utils/otp.js
// ✅ مركزية توليد وـ hashing الـ OTP
const crypto = require('crypto');

/**
 * يولّد OTP رقمي عشوائي مكون من 6 خانات
 * يستخدم crypto.randomInt لضمان عشوائية حقيقية (لا Math.random)
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * يستخدم HMAC بــ pepper غير مخزن في قاعدة البيانات.
 * هذا يمنع كسر OTP ذي الست خانات offline عند تسريب نسخة من DB وحدها.
 */
const getOtpPepper = (env = process.env) => (
  env.OTP_PEPPER || env.COOKIE_SECRET || env.JWT_SECRET || ''
);

const legacyHashOtp = (otp) => (
  crypto.createHash('sha256').update(String(otp)).digest('hex')
);

const hashOtp = (otp, env = process.env) => {
  const pepper = getOtpPepper(env);
  if (!pepper) {
    throw new Error('[otp] OTP_PEPPER أو COOKIE_SECRET أو JWT_SECRET مطلوب');
  }

  return crypto
    .createHmac('sha256', pepper)
    .update(`aoun:email-otp:v1:${String(otp)}`)
    .digest('hex');
};

const safeHexEqual = (left, right) => {
  if (!/^[a-f\d]{64}$/i.test(left ?? '') || !/^[a-f\d]{64}$/i.test(right ?? '')) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

/**
 * مقارنة OTP بشكل آمن ضد Timing Attacks
 * يقارن الـ hash المخزّن مع hash الـ input الجديد
 */
const verifyOtp = (inputOtp, storedHash) => {
  const inputHash = hashOtp(inputOtp);
  if (safeHexEqual(storedHash, inputHash)) return true;

  // توافق مؤقت مع الرموز الفعّالة التي أُنشئت قبل Flow 14.
  return safeHexEqual(storedHash, legacyHashOtp(inputOtp));
};

module.exports = {
  generateOtp,
  getOtpPepper,
  hashOtp,
  legacyHashOtp,
  safeHexEqual,
  verifyOtp,
};
