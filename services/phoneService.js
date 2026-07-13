// services/phoneService.js
// المسؤولية: التحقق من الهاتف عبر Firebase Phone Auth
// ✅ تم استبدال Twilio بـ Firebase Admin SDK
//    Firebase مجاني (10,000 تحقق/شهر) ويدعم +962 بشكل كامل
//
// ─── تدفق التحقق الجديد ──────────────────────────────────────
// 1. Frontend يرسل OTP مباشرة عبر Firebase Client SDK
// 2. بعد التأكيد، Firebase يعطي idToken
// 3. Frontend يرسل idToken لـ POST /api/phone/verify-otp
// 4. Backend يتحقق من idToken ويستخرج رقم الهاتف منه
// 5. Backend يحدّث phoneVerified=true و trustLevel=2

const User = require('../models/User');
const { verifyFirebasePhoneToken } = require('../integrations/smsService');

const OTP_RATE_LIMIT_MS = 60 * 1000;

// ─── التحقق من الرقم عبر Firebase idToken ────────────────────
// idToken: صادر من Firebase بعد تأكيد المستخدم للـ OTP على الـ Frontend
exports.verifyPhoneWithFirebase = async (userId, idToken) => {
  // 1. تحقق من الـ token واستخرج الرقم
  const firebasePhone = await verifyFirebasePhoneToken(idToken);

  // 2. تأكد أن الرقم غير مستخدم من حساب آخر مؤكد
  const existingPhone = await User.findOne({
    phone:         firebasePhone,
    phoneVerified: true,
    _id:           { $ne: userId },
  });

  if (existingPhone) {
    throw Object.assign(
      new Error('هذا الرقم مسجّل لدى حساب آخر بالفعل ❌'),
      { status: 409, code: 'PHONE_ALREADY_USED' }
    );
  }

  // 3. تحقق Rate Limit للرقم الحالي للمستخدم
  const user = await User.findById(userId).select('+phoneOtpSentAt phone isVerifiedStudent');
  if (!user) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });

  if (user.phoneOtpSentAt) {
    const elapsed = Date.now() - user.phoneOtpSentAt.getTime();
    if (elapsed < OTP_RATE_LIMIT_MS) {
      throw Object.assign(
        new Error('انتظر دقيقة واحدة قبل محاولة التحقق مجدداً ⏳'),
        { status: 429, code: 'OTP_RATE_LIMITED' }
      );
    }
  }

  // 4. تحديث: phoneVerified=true، trustLevel=2، احفظ الرقم من Firebase
  const phoneChanged = user.phone !== firebasePhone;

  await User.findByIdAndUpdate(userId, {
    phone:          firebasePhone,
    phoneVerified:  true,
    trustLevel:     2,
    phoneOtpSentAt: new Date(),
    // إذا تغير الرقم وليس طالباً محققاً — trustLevel يرتفع لـ 2 عند التحقق الناجح
    ...(phoneChanged && !user.isVerifiedStudent ? {} : {}),
  });

  return { phone: firebasePhone };
};

// ─── للتوافق مع الاستخدام القديم (deprecated) ─────────────────
// سيُحذف في النسخة القادمة بعد تحديث الـ Frontend
exports.createPhoneOtp  = async () => {
  throw Object.assign(
    new Error('createPhoneOtp محذوف — الرجاء استخدام Firebase Phone Auth في الـ Frontend'),
    { status: 501, code: 'USE_FIREBASE_CLIENT' }
  );
};
exports.verifyPhoneOtp  = async () => {
  throw Object.assign(
    new Error('verifyPhoneOtp محذوف — الرجاء إرسال idToken من Firebase عبر verify-token'),
    { status: 501, code: 'USE_FIREBASE_CLIENT' }
  );
};
