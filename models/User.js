// models/User.js
// ✅ Phase 1 Fix:
//    Bug #3 — أضيف verificationOtpExpiry للـ Schema
//    تحسين — أضيف select: false لحقل verificationOtpExpiry أيضاً

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, index: true },

    password: { type: String, required: true, select: false },

    phone:    { type: String },
    reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    avatar:   { type: String, default: '' },
    isBanned: { type: Boolean, default: false },

    resetPasswordToken:  { type: String,  select: false },
    resetPasswordExpire: { type: Date,    select: false },

    role: {
      type:    String,
      default: 'user',
      enum:    ['user', 'admin', 'super_admin'],
    },

    isVerified:      { type: Boolean, default: false },

    // ✅ Fix Bug #3 — OTP مع وقت انتهاء الصلاحية
    verificationOtp:       { type: String, select: false },
    verificationOtpExpiry: { type: Date,   select: false }, // ✅ جديد

    isVerifiedStudent: { type: Boolean, default: false },
    trustScore:        { type: Number,  default: 70 },
    quota:             { type: Number,  default: 2 },

    refreshToken:    { type: String, select: false },
    sessionIssuedAt: { type: Date,   select: false },

    totalDonations: { type: Number,   default: 0 },
    badges:         { type: [String], default: [] },

    trustLevel: {
      type:    Number,
      enum:    [1, 2],
      default: 1,
    },

    phoneVerified:   { type: Boolean, default: false },
    promotedByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);