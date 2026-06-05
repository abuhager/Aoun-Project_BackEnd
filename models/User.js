// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },

    // ✅ حذف index:true — unique:true يعمل index تلقائياً
    // userSchema.index({ email: 1 }) في الأسفل يكفي
    email:   { type: String, required: true, unique: true },

    password:  { type: String, required: true, select: false },
    avatar:    { type: String, default: '' },
    isBanned:  { type: Boolean, default: false },
    role: {
      type:    String,
      default: 'user',
      enum:    ['user', 'admin', 'super_admin'],
    },
    isVerified:             { type: Boolean, default: false },
    verificationOtp:        { type: String,  select: false },
    verificationOtpExpiry:  { type: Date,    select: false },

    // ✅ حذف unique:true المكرر — الـ index في الأسفل يحمله
    phone:         { type: String, sparse: true },
    phoneVerified: { type: Boolean, default: false },
    phoneOtp:      { type: String, select: false },
    phoneOtpExpiry:{ type: Date,   select: false },

    trustLevel: {
      type:    Number,
      enum:    [1, 2],
      default: 1,
    },
    trustScore:       { type: Number,   default: 70 },
    promotedByAdmin:  { type: Boolean,  default: false },
    isVerifiedStudent:{ type: Boolean,  default: false },
    quota:            { type: Number,   default: 2 },
    totalDonations:   { type: Number,   default: 0 },
    badges:           { type: [String], default: [] },
    reportedBy:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire:{ type: Date,   select: false },
    refreshToken:       { type: String, select: false },
    sessionIssuedAt:    { type: Date,   select: false },
  },
  { timestamps: true }
);

// ✅ تعريف الـ indexes مرة واحدة فقط هنا
userSchema.index({ email: 1 },              { unique: true });
userSchema.index({ phone: 1 },              { sparse: true, unique: true });
userSchema.index({ role: 1, isBanned: 1 });
userSchema.index({ trustLevel: 1 });
userSchema.index({ trustScore: -1 });
userSchema.index({ totalDonations: -1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);