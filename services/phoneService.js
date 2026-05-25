// services/phoneService.js
// المسؤولية: توليد OTP + حفظه في DB + التحقق منه
// لا يتعامل مع الإرسال — هذا مسؤولية whatsappService.js

const crypto = require('crypto');
const User   = require('../models/User');

// ─── الثوابت ──────────────────────────────────────────────────
const OTP_LENGTH_BYTES = 3;          // 3 bytes = 6 أرقام hex → نحولها لـ 6 أرقام decimal
const OTP_TTL_MINUTES  = 10;         // ينتهي بعد 10 دقائق
const OTP_RATE_LIMIT   = 60 * 1000; // دقيقة واحدة بين كل طلب وآخر (بالـ ms)

// ─── توليد OTP عشوائي 6 أرقام ────────────────────────────────
function generateOtp() {
  // crypto.randomInt: آمن تشفيرياً، يولّد رقماً بين 100000 و999999
  return crypto.randomInt(100_000, 999_999).toString();
}

// ─── حفظ OTP في DB وإعادته للـ caller ────────────────────────
// يُعيد: { otp, phone } — الـ otp يُمرَّر لـ whatsappService للإرسال
// لا يُعيده للـ client أبداً
async function createPhoneOtp(userId, phone) {
  const user = await User.findById(userId).select('+phoneOtp +phoneOtpExpiry');

  if (!user) {
    throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  }

  // ✅ إضافة هنا — قبل Rate Limit
  const existingPhone = await User.findOne({
    phone:         phone.trim(),
    phoneVerified: true,
    _id:           { $ne: userId },
  });

  if (existingPhone) {
    throw Object.assign(
      new Error('هذا الرقم مسجّل لدى حساب آخر بالفعل ❌'),
      { status: 409, code: 'PHONE_ALREADY_USED' }
    );
  }

  // تحقق من Rate Limit: هل الـ OTP الحالي لم يمر عليه دقيقة بعد؟
  if (user.phoneOtpExpiry) {
    const issuedAt = user.phoneOtpExpiry.getTime() - OTP_TTL_MINUTES * 60 * 1000;
    if (Date.now() - issuedAt < OTP_RATE_LIMIT) {
      throw Object.assign(
        new Error('انتظر دقيقة واحدة قبل طلب رمز جديد ⏳'),
        { status: 429, code: 'OTP_RATE_LIMITED' }
      );
    }
  }

  const otp    = generateOtp();
  const expiry = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await User.findByIdAndUpdate(userId, {
    phone,
    phoneOtp:       otp,
    phoneOtpExpiry: expiry,
  });

  return { otp, phone };
}
// ─── التحقق من OTP المُدخَل ───────────────────────────────────
async function verifyPhoneOtp(userId, inputOtp) {
  const user = await User.findById(userId).select('+phoneOtp +phoneOtpExpiry');

  if (!user) {
    throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  }

  // ✅ تحقق من الصلاحية أولاً — لا تكشف عن سبب الفشل بالتفصيل
  const isExpired = !user.phoneOtpExpiry || user.phoneOtpExpiry < new Date();
  const isMatch   = user.phoneOtp === inputOtp;

  if (isExpired || !isMatch) {
    throw Object.assign(
      new Error('رمز التحقق غير صحيح أو انتهت صلاحيته ❌'),
      { status: 400, code: 'INVALID_OTP' }
    );
  }

  // ✅ نجح التحقق — امسح الـ OTP فوراً (single-use) وارفع trustLevel
  await User.findByIdAndUpdate(userId, {
    phoneVerified:  true,
    trustLevel:     2,
    phoneOtp:       null,
    phoneOtpExpiry: null,
  });

  return true;
}

module.exports = { createPhoneOtp, verifyPhoneOtp };