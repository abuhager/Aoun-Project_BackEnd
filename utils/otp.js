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
 * يحوّل OTP إلى SHA-256 hash قبل التخزين
 * لا نخزّن الـ OTP الأصلي أبداً في DB
 */
const hashOtp = (otp) =>
  crypto.createHash('sha256').update(String(otp)).digest('hex');

/**
 * مقارنة OTP بشكل آمن ضد Timing Attacks
 * يقارن الـ hash المخزّن مع hash الـ input الجديد
 */
const verifyOtp = (inputOtp, storedHash) => {
  const inputHash = hashOtp(inputOtp);
  const a = Buffer.from(storedHash,  'hex');
  const b = Buffer.from(inputHash,   'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

module.exports = { generateOtp, hashOtp, verifyOtp };