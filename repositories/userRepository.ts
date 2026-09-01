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

const activeAccountEligibility = () => ({
  isVerified: true,
  // الحسابات القديمة قد لا تحتوي هذين الحقلين؛ نمنع true فقط.
  isBanned: { $ne: true },
  isFrozen: { $ne: true },
});

const leaderboardEligibility = () => ({
  ...activeAccountEligibility(),
});

// ─── قراءة ───────────────────────────────────────────────────

exports.findByEmail = (
  email,
  options: { selectOtp?: boolean } = {}
) => {
  let query = User.findOne({ email });
  if (options.selectOtp) {
    query = query.select('+verificationOtp +verificationOtpExpiry +otpAttempts');
  }
  return query;
};

exports.findByEmailWithPassword = (email) =>
  User.findOne({ email }).select(
    '+password +verificationOtpExpiry +otpAttempts +sessionVersion'
  );

exports.createUser = (data) => User.create(data);

exports.saveUser = (user) => user.save();

// ✅ [SEC-REPO-01] + [DUP-REPO-01]: isFrozen مُضاف عبر BASE_USER_FIELDS
exports.findById = (id) =>
  User.findById(id).select(USER_FIELDS);

// ✅ [SEC-REPO-02] isFrozen + isVerified + isBanned مطلوبة في refreshLogic
// بدون هذه الحقول: مستخدم مجمَّد أو غير مُفعَّل يستطيع تجديد التوكن
exports.findByIdWithRefreshToken = (id) =>
  User.findById(id).select(
    '+refreshToken +previousRefreshToken +previousRefreshTokenExpire ' +
    '+sessionVersion +sessionIssuedAt'
  );

exports.findAuthStateById = (id) =>
  User.findById(id)
    .select(
      'name role trustLevel phoneVerified isVerified isBanned isFrozen ' +
      '+sessionVersion +sessionIssuedAt'
    )
    .lean();

exports.findByResetToken = (hashedToken) =>
  User.findOne({
    resetPasswordToken:  hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password');

exports.updateUser = (id, update) =>
  User.findByIdAndUpdate(id, update, { returnDocument: 'after' });

exports.beginUserSession = (id) =>
  User.findByIdAndUpdate(
    id,
    {
      $inc: { sessionVersion: 1 },
      $set: { sessionIssuedAt: new Date() },
      $unset: {
        refreshToken: 1,
        previousRefreshToken: 1,
        previousRefreshTokenExpire: 1,
      },
    },
    { returnDocument: 'after' }
  ).select('+sessionVersion');

exports.storeRefreshToken = (id, sessionVersion, refreshHash) =>
  User.findOneAndUpdate(
    { _id: id, sessionVersion },
    { $set: { refreshToken: refreshHash } },
    { returnDocument: 'after' }
  ).select('+sessionVersion');

exports.rotateRefreshToken = (
  userId,
  sessionVersion,
  oldHash,
  newHash,
  newIssuedAt,
  previousTokenExpire
) =>
  User.findOneAndUpdate(
    { _id: userId, sessionVersion, refreshToken: oldHash },
    {
      $set: {
        refreshToken: newHash,
        previousRefreshToken: oldHash,
        previousRefreshTokenExpire: previousTokenExpire,
        sessionIssuedAt: newIssuedAt,
      },
    },
    { returnDocument: 'after' }
  ).select('+sessionVersion');

exports.findByIdWithSession = (id) =>
  User.findById(id).select('+refreshToken +sessionVersion +sessionIssuedAt');

// ✅ [DUP-REPO-01] ADMIN_FIELDS تُضيف reportedBy فوق BASE_USER_FIELDS
exports.findByIdForAdmin = (id) =>
  User.findById(id).select(ADMIN_FIELDS);

// ✅ FIX [ARCH-PROF-02]: setTrustLevelAndQuota تقبل quota معاً
exports.setTrustLevelAndQuota = (id, level, quota) =>
  User.findByIdAndUpdate(
    id,
    { trustLevel: level, quota, promotedByAdmin: true },
    { returnDocument: 'after' }
  ).select(
    'name email phone avatar role trustLevel trustScore quota totalDonations ' +
    'isVerified isVerifiedStudent phoneVerified isBanned isFrozen banReason ' +
    'createdAt updatedAt'
  );

exports.setTrustLevel = (id, level) =>
  User.findByIdAndUpdate(id, { trustLevel: level }, { returnDocument: 'after' })
    .select('name email trustLevel isVerifiedStudent phoneVerified isBanned');

exports.findByIdWithPassword = (id) =>
  User.findById(id).select('+password');

exports.findProfileUpdateState = (id) =>
  User.findById(id)
    .select(
      'phone phoneVerified trustLevel isVerifiedStudent promotedByAdmin avatar +avatarPublicId'
    )
    .lean();

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
  ).select('+sessionVersion');

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
  User.findOne({
    phone,
    phoneVerified: true,
    _id: { $ne: excludeUserId },
  }).select('_id').lean();

exports.consumeResetToken = (hashedToken, hashedPassword) =>
  User.findOneAndUpdate(
    {
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    },
    {
      $set: { password: hashedPassword, sessionIssuedAt: new Date() },
      $inc: { sessionVersion: 1 },
      $unset: {
        resetPasswordToken: 1,
        resetPasswordExpire: 1,
        refreshToken: 1,
        previousRefreshToken: 1,
        previousRefreshTokenExpire: 1,
      },
    },
    { returnDocument: 'after' }
  ).select('_id +sessionVersion');

exports.changePassword = (userId, hashedPassword) =>
  User.findByIdAndUpdate(
    userId,
    {
      $set: { password: hashedPassword, sessionIssuedAt: new Date() },
      $inc: { sessionVersion: 1 },
      $unset: {
        refreshToken: 1,
        previousRefreshToken: 1,
        previousRefreshTokenExpire: 1,
      },
    },
    { returnDocument: 'after' }
  ).select('_id +sessionVersion');

// ─── إلغاء صلاحية الجلسة ─────────────────────────────────────
exports.invalidateUserSession = (userId) =>
  User.findByIdAndUpdate(userId, {
    $inc: { sessionVersion: 1 },
    $set: { sessionIssuedAt: new Date() },
    $unset: {
      refreshToken: 1,
      previousRefreshToken: 1,
      previousRefreshTokenExpire: 1,
    },
  });

// ✅ FIX [PERF-PROF-02]: lean() مباشرة — لا يجوز استدعاء .select().lean() فوقها
exports.findPublicProfile = (id) =>
  User.findOne({
    _id: id,
    ...activeAccountEligibility(),
  })
    .select(
      'name avatar role trustScore trustLevel totalDonations badges ' +
      'isVerifiedStudent createdAt'
    )
    .lean();

exports.findLeaderboardUsers = (limit) =>
  User.find(leaderboardEligibility())
    .select('name avatar trustScore totalDonations')
    .sort({ trustScore: -1, totalDonations: -1, _id: 1 })
    .limit(limit)
    .lean();

exports.findLeaderboardUser = (userId) =>
  User.findOne({ _id: userId, ...leaderboardEligibility() })
    .select('trustScore totalDonations')
    .lean();

exports.countLeaderboardUsersAhead = (user) =>
  User.countDocuments({
    ...leaderboardEligibility(),
    $or: [
      { trustScore: { $gt: user.trustScore } },
      {
        trustScore: user.trustScore,
        totalDonations: { $gt: user.totalDonations },
      },
      {
        trustScore: user.trustScore,
        totalDonations: user.totalDonations,
        _id: { $lt: user._id },
      },
    ],
  });
