// utils/otp.js
// ✅ مركزية توليد وـ hashing الـ OTP
import crypto from 'node:crypto';

/**
 * يولّد OTP رقمي عشوائي مكون من 6 خانات
 * يستخدم crypto.randomInt لضمان عشوائية حقيقية (لا Math.random)
 */
const generateOtp = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * يستخدم HMAC بــ pepper غير مخزن في قاعدة البيانات.
 * هذا يمنع كسر OTP ذي الست خانات offline عند تسريب نسخة من DB وحدها.
 */
const getOtpPepper = (env: NodeJS.ProcessEnv = process.env): string => (
  env.OTP_PEPPER || env.COOKIE_SECRET || env.JWT_SECRET || ''
);

const legacyHashOtp = (otp: string | number): string => (
  crypto.createHash('sha256').update(String(otp)).digest('hex')
);

const hashOtp = (otp: string | number, env: NodeJS.ProcessEnv = process.env): string => {
  const pepper = getOtpPepper(env);
  if (!pepper) {
    throw new Error('[otp] OTP_PEPPER أو COOKIE_SECRET أو JWT_SECRET مطلوب');
  }

  return crypto
    .createHmac('sha256', pepper)
    .update(`aoun:email-otp:v1:${String(otp)}`)
    .digest('hex');
};

const safeHexEqual = (left: unknown, right: unknown): boolean => {
  const leftHex = String(left ?? '');
  const rightHex = String(right ?? '');
  if (!/^[a-f\d]{64}$/i.test(leftHex) || !/^[a-f\d]{64}$/i.test(rightHex)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex'));
};

/**
 * مقارنة OTP بشكل آمن ضد Timing Attacks
 * يقارن الـ hash المخزّن مع hash الـ input الجديد
 */
const verifyOtp = (inputOtp: string | number, storedHash: unknown): boolean => {
  const inputHash = hashOtp(inputOtp);
  if (safeHexEqual(storedHash, inputHash)) return true;

  // توافق مؤقت مع الرموز الفعّالة التي أُنشئت قبل Flow 14.
  return safeHexEqual(storedHash, legacyHashOtp(inputOtp));
};

const otpUtils = {
  generateOtp,
  getOtpPepper,
  hashOtp,
  legacyHashOtp,
  safeHexEqual,
  verifyOtp,
};

export = otpUtils;
