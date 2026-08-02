// repositories/userRepository.js
// ✅ FIX [DUP-PROF-02]  : phone + phoneVerified في findById
// ✅ FIX [PERF-PROF-02] : findPublicProfile تُعيد lean() مباشرة
// ✅ FIX [SEC-REPO-01]  : isFrozen أُضيف لـ findById — بدونه buildSafeUser يُرجع undefined
// ✅ FIX [SEC-REPO-02]  : findByIdWithRefreshToken تجلب isFrozen+isVerified+isBanned
//                         لتمكين refreshLogic من فحص حالة الحساب كاملاً
// ✅ FIX [DUP-REPO-01]  : ثوابت BASE_USER_FIELDS/USER_FIELDS/ADMIN_FIELDS
//                         تحذف تكرار .select() strings الطويلة

const User = require('../models/User');

// ✅ [DUP-REPO-01] ثوابت مشتركة — تعديل واحد يُحدِّث كل الدوال
const BASE_USER_FIELDS =
  'name email phone avatar role trustScore trustLevel ' +
  'quota isVerified isVerifiedStudent isBanned isFrozen ' + // ← isFrozen هنا للجميع
  'totalDonations badges createdAt';

const USER_FIELDS  = BASE_USER_FIELDS + ' phoneVerified';       // للمستخدم نفسه
const ADMIN_FIELDS = BASE_USER_FIELDS + ' reportedBy';          // للأدمن

// ─── قراءة ───────────────────────────────────────────────────

exports.findByEmail = (email, options = {}) => {
  let query = User.findOne({ email });
  if (options.selectOtp) {
    query = query.select('+verificationOtp +verificationOtpExpiry +otpAttempts');
  }
  return query;
};

exports.findByEmailWithPassword = (email) =>
  User.findOne({ email }).select('+password +verificationOtpExpiry +otpAttempts');

exports.createUser = (data) => User.create(data);

exports.saveUser = (user) => user.save();

// ✅ [SEC-REPO-01] + [DUP-REPO-01]: isFrozen مُضاف عبر BASE_USER_FIELDS
exports.findById = (id) =>
  User.findById(id).select(USER_FIELDS);

// ✅ [SEC-REPO-02] isFrozen + isVerified + isBanned مطلوبة في refreshLogic
// بدون هذه الحقول: مستخدم مجمَّد أو غير مُفعَّل يستطيع تجديد التوكن
exports.findByIdWithRefreshToken = (id) =>
  User.findById(id).select('+refreshToken isFrozen isBanned isVerified');

exports.findByResetToken = (hashedToken) =>
  User.findOne({
    resetPasswordToken:  hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password');

exports.updateUser = (id, update) =>
  User.findByIdAndUpdate(id, update, { returnDocument: 'after' });

exports.rotateRefreshToken = (userId, oldHash, newHash, newIssuedAt) =>
  User.findOneAndUpdate(
    { _id: userId, refreshToken: oldHash },
    { $set: { refreshToken: newHash, sessionIssuedAt: newIssuedAt } },
    { returnDocument: 'after' }
  ).select('_id name email role trustLevel isBanned quota trustScore');

exports.findByIdWithSession = (id) =>
  User.findById(id).select('+refreshToken +sessionIssuedAt');

// ✅ [DUP-REPO-01] ADMIN_FIELDS تُضيف reportedBy فوق BASE_USER_FIELDS
exports.findByIdForAdmin = (id) =>
  User.findById(id).select(ADMIN_FIELDS);

// ✅ FIX [ARCH-PROF-02]: setTrustLevelAndQuota تقبل quota معاً
exports.setTrustLevelAndQuota = (id, level, quota) =>
  User.findByIdAndUpdate(
    id,
    { trustLevel: level, quota, promotedByAdmin: true },
    { returnDocument: 'after' }
  ).select('name email trustLevel quota isVerifiedStudent phoneVerified isBanned');

exports.setTrustLevel = (id, level) =>
  User.findByIdAndUpdate(id, { trustLevel: level }, { returnDocument: 'after' })
    .select('name email trustLevel isVerifiedStudent phoneVerified isBanned');

exports.findByIdWithPassword = (id) =>
  User.findById(id).select('+password');

// ─── دوال verifyEmailLogic ────────────────────────────────────

exports.findAndIncrementOtpAttempts = (email, maxAttempts = 5) =>
  User.findOneAndUpdate(
    {
      email,
      isVerified: false,
      $or: [
        { otpAttempts: { $lt: maxAttempts } },
        { otpAttempts: { $exists: false } },
      ],
    },
    { $inc: { otpAttempts: 1 } },
    {
      returnDocument: 'after',
      select: '+verificationOtp +verificationOtpExpiry +otpAttempts +trustLevel +role +quota',
    }
  ).lean();

exports.findEmailStatus = (email) =>
  User.findOne({ email }).select('isVerified otpAttempts').lean();

exports.atomicVerifyAndComplete = (userId, currentOtpHash, updateData) =>
  User.findOneAndUpdate(
    { _id: userId, verificationOtp: currentOtpHash },
    updateData,
    { returnDocument: 'after' }
  );

exports.resetOtpAttemptsAfterLock = (email) =>
  User.updateOne(
    { email },
    {
      $unset: { verificationOtp: 1, verificationOtpExpiry: 1 },
      $set:   { otpAttempts: 0 },
    }
  );

// ─── فحص تكرار رقم الهاتف ────────────────────────────────────
exports.findByPhoneExcluding = (phone, excludeUserId) =>
  User.findOne({ phone, _id: { $ne: excludeUserId } }).select('_id').lean();

// ─── إلغاء صلاحية الجلسة ─────────────────────────────────────
exports.invalidateUserSession = (userId) =>
  User.findByIdAndUpdate(userId, {
    $unset: { refreshToken: 1, sessionIssuedAt: 1 },
  });

// ✅ FIX [PERF-PROF-02]: lean() مباشرة — لا يجوز استدعاء .select().lean() فوقها
exports.findPublicProfile = (id) =>
  User.findById(id)
    .select('name avatar role trustScore trustLevel totalDonations isVerifiedStudent isBanned createdAt')
    .lean();