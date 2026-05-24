// repositories/userRepository.js
// ✅ Phase 1 Fix:
//    - أضيف isBanned لـ findById select
//    - أضيف selectOtpExpiry option لجلب verificationOtpExpiry

const User = require('../models/User');

exports.findByEmail = (email, options = {}) => {
  let query = User.findOne({ email });
  // ✅ جلب OTP + Expiry معاً عند الحاجة
  if (options.selectOtp) query = query.select('+verificationOtp +verificationOtpExpiry');
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

exports.rotateRefreshToken = (userId, oldHash, _unused) =>
  User.findOneAndUpdate(
    { _id: userId, refreshToken: oldHash },
    { $set: { refreshToken: null } }, // يُصفَّر مؤقتاً — يُحدَّث في الـ service
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