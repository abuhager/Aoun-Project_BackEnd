// repositories/userRepository.js
const User = require('../models/User');

// ✅ أضف options لدعم selectOtp — باقي الـ functions ما تحتاج تغيير
exports.findByEmail = (email, options = {}) => {
  let query = User.findOne({ email });
  if (options.selectOtp) query = query.select('+verificationOtp');
  return query;
};

exports.findByEmailWithPassword = (email) =>
  User.findOne({ email }).select('+password');

exports.createUser = (data) => User.create(data);

exports.saveUser = (user) => user.save();

exports.findById = (id) =>
  User.findById(id).select(
    'name email phone avatar role trustScore trustLevel ' +
    'quota isVerified isVerifiedStudent isBanned ' +
    'totalDonations badges createdAt updatedAt'
  );
exports.findByIdWithRefreshToken = (id) =>
  User.findById(id).select('+refreshToken');

exports.findByResetToken = (hashedToken) =>
  User.findOne({
    resetPasswordToken:  hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password');

exports.updateUser = (id, update) =>
  User.findByIdAndUpdate(id, update, { new: true });

exports.rotateRefreshToken = (userId, oldHash, newHash) =>
  User.findOneAndUpdate(
    {
      _id:          userId,
      refreshToken: oldHash,   // ← الشرط: طابق القديم أولاً
    },
    { $set: { refreshToken: newHash } },
    { new: true }              // ← أرجع الوثيقة المحدّثة
  ).select('_id name email role trustLevel isBanned');
  exports.findByIdWithSession = (id) =>
  User.findById(id).select('+refreshToken +sessionIssuedAt');