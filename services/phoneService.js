// services/phoneService.js
// المسؤولية: التحقق من الهاتف عبر Twilio Verify (بدون تخزين OTP في DB)
// ✅ إصلاح: Twilio يدير الرمز — نحن نطلب الإرسال ونتحقق من الصحة فقط
// ✅ إصلاح [TRUST-PHONE-01]: إعادة احتساب trustLevel عند تغيير الرقم

const User               = require('../models/User');
const { checkOtpWhatsApp } = require('../integrations/smsService');

// ─── الثوابت ──────────────────────────────────────────────────
const OTP_RATE_LIMIT_MS = 60 * 1000; // دقيقة واحدة بين كل طلب

// ─── التحضير لإرسال OTP: Rate Limit + تحقق من التكرار ────────
async function createPhoneOtp(userId, phone) {
  const user = await User.findById(userId).select('+phoneOtpSentAt');

  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });

  // تحقق أن الرقم غير مستخدم لحساب آخر
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

  // Rate Limit
  if (user.phoneOtpSentAt) {
    const elapsed = Date.now() - user.phoneOtpSentAt.getTime();
    if (elapsed < OTP_RATE_LIMIT_MS) {
      throw Object.assign(
        new Error('انتظر دقيقة واحدة قبل طلب رمز جديد ⏳'),
        { status: 429, code: 'OTP_RATE_LIMITED' }
      );
    }
  }

  // ✅ [TRUST-PHONE-01]: عند تغيير الرقم — إعادة ضبط phoneVerified
  // وإعادة احتساب trustLevel بناءً على مصادر الثقة المتبقية
  const phoneChanged = user.phone !== phone.trim();
  const updateFields = {
    phone,
    phoneOtpSentAt: new Date(),
  };

  if (phoneChanged) {
    updateFields.phoneVerified = false;
    // إذا لم يكن هناك توثيق طالب صالح → يرجع إلى Level 1
    // إذا كان هناك توثيق طالب → يبقى على مستواه الحالي
    if (!user.isVerifiedStudent) {
      updateFields.trustLevel = 1;
    }
  }

  await User.findByIdAndUpdate(userId, updateFields);

  // أعد phone فقط — الـ controller يمرره لـ smsService
  return { phone };
}

// ─── التحقق من OTP عبر Twilio ─────────────────────────────────
async function verifyPhoneOtp(userId, inputOtp) {
  const user = await User.findById(userId).select('phone isVerifiedStudent');

  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });
  if (!user.phone) throw Object.assign(new Error('لم يتم إرسال رمز لهذا الحساب'), { status: 400 });

  // اسأل Twilio عن صحة الرمز
  const approved = await checkOtpWhatsApp(user.phone, inputOtp);

  if (!approved) {
    throw Object.assign(
      new Error('رمز التحقق غير صحيح أو انتهت صلاحيته ❌'),
      { status: 400, code: 'INVALID_OTP' }
    );
  }

  // ✅ نجح — ارفع trustLevel إلى 2 دائماً عند التحقق الناجح
  await User.findByIdAndUpdate(userId, {
    phoneVerified:  true,
    trustLevel:     2,
    phoneOtpSentAt: null,
  });

  return true;
}

module.exports = { createPhoneOtp, verifyPhoneOtp };
