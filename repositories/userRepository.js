// repositories/userRepository.js
// ✅ Phase 1 Fix:
//    - أضيف isBanned لـ findById select
//    - أضيف selectOtpExpiry option لجلب verificationOtpExpiry

const User = require('../models/User');

exports.findByEmail = (email, options = {}) => {
  let query = User.findOne({ email });
  if (options.selectOtp) {
    query = query.select('+verificationOtp +verificationOtpExpiry +otpAttempts');
  }
  return query;
};

exports.findByEmailWithPassword = (email) =>
  User.findOne({ email }).select('+password');

exports.createUser = (data) => User.create(data);

exports.saveUser = (user) => user.save();

exports.findById = (id) =>
  User.findById(id).select(
    'name email avatar role trustScore trustLevel ' +
    'quota isVerified isVerifiedStudent isBanned ' + // ✅ أضيف isBanned
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

// repositories/userRepository.js — rotateRefreshToken المُصلَح

exports.rotateRefreshToken = (userId, oldHash, newHash, newIssuedAt) =>
  User.findOneAndUpdate(
    {
      _id:          userId,
      refreshToken: oldHash,   // ← الشرط: فقط لو الـ hash مطابق
    },
    {
      $set: {
        refreshToken:    newHash,       // ✅ يُكتب مباشرة — لا خطوة ثانية
        sessionIssuedAt: newIssuedAt,
      },
    },
    { new: true }
  ).select('_id name email role trustLevel isBanned quota trustScore');
  
exports.findByIdWithSession = (id) =>
  User.findById(id).select('+refreshToken +sessionIssuedAt');

exports.findByIdForAdmin = (id) =>
  User.findById(id).select(
    'name email phone avatar role trustScore trustLevel ' +
    'quota isVerified isVerifiedStudent isBanned ' +
    'totalDonations badges reportedBy createdAt'
  );
  // ─── Admin: ترقية/خفض trustLevel ─────────────────────────────
exports.setTrustLevel = (id, level) =>
  User.findByIdAndUpdate(id, { trustLevel: level }, { new: true })
      .select('name email trustLevel isVerifiedStudent phoneVerified isBanned');
      
exports.findByIdWithPassword = (id) =>
  User.findById(id).select('+password');