const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyFirebasePhoneToken } = require('../integrations/smsService');
const sessionCache = require('../utils/sessionCache');
const {
  isPhoneVerificationEnabled,
} = require('../middlewares/phoneVerificationFeature');
const {
  isValidJordanPhone,
  normalizeJordanPhone,
} = require('../utils/phoneUtils');

const serviceError = (message, status, code) =>
  new AppError(message, status, code);

exports.verifyPhoneWithFirebase = async (userId, idToken) => {
  if (!isPhoneVerificationEnabled()) {
    throw serviceError(
      'التحقق من الهاتف متوقف مؤقتاً',
      503,
      'PHONE_VERIFICATION_DISABLED'
    );
  }

  const firebasePhone = normalizeJordanPhone(
    await verifyFirebasePhoneToken(idToken)
  );

  if (!isValidJordanPhone(firebasePhone)) {
    throw serviceError(
      'رقم الهاتف المؤكد ليس رقماً أردنياً مدعوماً',
      400,
      'UNSUPPORTED_PHONE_NUMBER'
    );
  }

  const existingPhone = await User.findOne({
    phone: firebasePhone,
    phoneVerified: true,
    _id: { $ne: userId },
  }).select('_id').lean();

  if (existingPhone) {
    throw serviceError(
      'هذا الرقم مسجّل لدى حساب آخر بالفعل ❌',
      409,
      'PHONE_ALREADY_USED'
    );
  }

  let updated;
  try {
    updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: { phone: firebasePhone, phoneVerified: true },
        $max: { trustLevel: 2 },
        $unset: { phoneOtp: 1, phoneOtpExpiry: 1, phoneOtpSentAt: 1 },
      },
      { returnDocument: 'after', runValidators: true }
    ).select('phone phoneVerified trustLevel');
  } catch (error) {
    if (error?.code === 11000) {
      throw serviceError(
        'هذا الرقم مسجّل لدى حساب آخر بالفعل ❌',
        409,
        'PHONE_ALREADY_USED'
      );
    }
    throw error;
  }

  if (!updated) {
    throw serviceError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  }

  sessionCache.invalidate(userId);
  return { phone: updated.phone, trustLevel: updated.trustLevel };
};
