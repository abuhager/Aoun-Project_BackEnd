// repositories/userRepository.js
// ✅ FIX [LOGIC-AUTH-01]: إضافة دوال مخصصة لـ verifyEmailLogic تستبدل require('../models/User') المباشر
// ✅ FIX [LOGIC-AUTH-02]: findByEmailWithPassword يجلب +verificationOtpExpiry +otpAttempts للـ loginLogic
// ✅ FIX [LOGIC-AUTH-03]: إضافة findByPhoneExcluding لفحص تكرار رقم الهاتف في updateMeLogic

const User = require('../models/User');

// ── قراءة ─────────────────────────────────────────────────────

exports.findByEmail = (email, options = {}) => {
  let query = User.findOne({ email });
  if (options.selectOtp) {
    query = query.select('+verificationOtp +verificationOtpExpiry +otpAttempts');
  }
  return query;
};

// ✅ FIX [LOGIC-AUTH-02]: أضيف +verificationOtpExpiry +otpAttempts
// loginLogic يحتاجهما لفحص Cooldown وحد المحاولات قبل إصدار OTP جديد
exports.findByEmailWithPassword = (email) =>
  User.findOne({ email }).select('+password +verificationOtpExpiry +otpAttempts');

exports.createUser = (data) => User.create(data);

exports.saveUser = (user) => user.save();

exports.findById = (id) =>
  User.findById(id).select(
    'name email avatar role trustScore trustLevel ' +
    'quota isVerified isVerifiedStudent isBanned ' +
    'totalDonations badges createdAt'
  );

exports.findByIdWithRefreshToken = (id) =>
  User.findById(id).select('+refreshToken');

exports.findByResetToken = (hashedToken) =>
  User.findOne({
    resetPasswordToken:  hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password');

exports.updateUser = (id, update) =>
  User.findByIdAndUpdate(id, update, { returnDocument: 'after' });

exports.rotateRefreshToken = (userId, oldHash, newHash, newIssuedAt) =>
  User.findOneAndUpdate(
    {
      _id:          userId,
      refreshToken: oldHash,
    },
    {
      $set: {
        refreshToken:    newHash,
        sessionIssuedAt: newIssuedAt,
      },
    },
    { returnDocument: 'after' }
  ).select('_id name email role trustLevel isBanned quota trustScore');

exports.findByIdWithSession = (id) =>
  User.findById(id).select('+refreshToken +sessionIssuedAt');

exports.findByIdForAdmin = (id) =>
  User.findById(id).select(
    'name email phone avatar role trustScore trustLevel ' +
    'quota isVerified isVerifiedStudent isBanned ' +
    'totalDonations badges reportedBy createdAt'
  );

exports.setTrustLevel = (id, level) =>
  User.findByIdAndUpdate(id, { trustLevel: level }, { returnDocument: 'after' })
      .select('name email trustLevel isVerifiedStudent phoneVerified isBanned');

exports.findByIdWithPassword = (id) =>
  User.findById(id).select('+password');

// ── FIX [LOGIC-AUTH-01]: دوال مخصصة لـ verifyEmailLogic ──────────────────
// تستبدل require('../models/User') المباشر في authService.js
// وتُبقي كل استعلامات DB في طبقة الـ Repository

// الخطوة 1: قراءة ذرية مع increment للـ otpAttempts في عملية واحدة
exports.findAndIncrementOtpAttempts = (email, maxAttempts = 5) =>
  User.findOneAndUpdate(
    {
      email,
      isVerified: false,
      $or: [
        { otpAttempts: { $lt: maxAttempts } }, // ← أصبح ديناميكياً
        { otpAttempts: { $exists: false } },
      ],
    },
    { $inc: { otpAttempts: 1 } },
    {
      returnDocument: 'after',
      select: '+verificationOtp +verificationOtpExpiry +otpAttempts +trustLevel +role +quota',
    }
  ).lean();

// الخطوة 2: قراءة حالة المستخدم فقط (للتمييز بين 429 و 404 و 400)
exports.findEmailStatus = (email) =>
  User.findOne({ email }).select('isVerified otpAttempts').lean();

// الخطوة 3: إتمام التحقق وتصفير الـ OTP بشكل ذري
exports.completeEmailVerification = (userId, updateData) =>
  User.updateOne({ _id: userId }, updateData);

// الخطوة 4: تصفير محاولات OTP بعد تجاوز الحد (إعادة ضبط لطلب رمز جديد)
exports.resetOtpAttemptsAfterLock = (email) =>
  User.updateOne(
    { email },
    {
      $unset: { verificationOtp: 1, verificationOtpExpiry: 1 },
      $set:   { otpAttempts: 0 },
    }
  );

// ── FIX [LOGIC-AUTH-03]: فحص تكرار رقم الهاتف قبل الحفظ ─────────────────
// يُستخدم في updateMeLogic قبل user.save() لتجنب MongoServerError 11000
exports.findByPhoneExcluding = (phone, excludeUserId) =>
  User.findOne({
    phone,
    _id: { $ne: excludeUserId },
  }).select('_id').lean();

// ── إلغاء صلاحية الجلسة (مستخدَمة في rotateRefreshToken عند اكتشاف إعادة الاستخدام) ──
exports.invalidateUserSession = (userId) =>
  User.findByIdAndUpdate(userId, {
    $unset: { refreshToken: 1, sessionIssuedAt: 1 },
  });

  exports.findPublicProfile = (id) =>
  User.findById(id)
    .select('name avatar role trustScore trustLevel totalDonations isVerifiedStudent isBanned createdAt')
    .lean();