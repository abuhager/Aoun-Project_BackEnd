// repositories/phoneRepository.js
const User = require('../models/User');

/** احفظ OTP الهاتف + وقت الانتهاء + عداد المحاولات */
exports.savePhoneOtp = (userId, phone, otp, expiry) =>
  User.findByIdAndUpdate(userId, {
    $set: {
      phone,
      phoneOtp:        otp,
      phoneOtpExpiry:  expiry,
      phoneOtpSentAt:  new Date(),
    },
  });

/** اجلب المستخدم مع حقول OTP الهاتف */
exports.findWithPhoneOtp = (userId) =>
  User.findById(userId).select(
    '+phone +phoneOtp +phoneOtpExpiry +phoneOtpSentAt +trustLevel'
  );

/** بعد التحقق الناجح — احذف OTP وارفع trustLevel */
exports.confirmPhoneVerified = (userId, phone) =>
  User.findByIdAndUpdate(userId, {
    $set:   { phone, trustLevel: 2, isVerifiedPhone: true },
    $unset: { phoneOtp: '', phoneOtpExpiry: '', phoneOtpSentAt: '' },
  });

/** تحقق هل الهاتف مسجّل مسبقاً لمستخدم آخر */
exports.findByPhone = (phone) =>
  User.findOne({ phone }).select('_id').lean();