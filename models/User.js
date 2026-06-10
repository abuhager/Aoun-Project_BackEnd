// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name:              { type: String, required: true, trim: true },

    // ✅ إصلاح Duplicate Index: حذف unique:true من هنا — الفهرس مُعرَّف أسفله في schema.index()
    email:             { type: String, required: true },

    password:          { type: String, required: true, select: false },
    avatar:            { type: String, default: '' },
    isBanned:          { type: Boolean, default: false },
    role:              { type: String, default: 'user', enum: ['user', 'admin', 'super_admin'] },
    isVerified:        { type: Boolean, default: false },

    // ── OTP الإيميل ──────────────────────────────────────────
    verificationOtp:       { type: String, select: false },
    verificationOtpExpiry: { type: Date,   select: false },
    otpAttempts:           { type: Number, default: 0, select: false },

    // ── OTP الهاتف ─────────────────────────────────────────
    // ✅ إصلاح Duplicate Index: حذف sparse:true من هنا — الفهرس مُعرَّف أسفله
    phone:             { type: String },
    phoneVerified:     { type: Boolean, default: false },
    phoneOtp:          { type: String, select: false },
    phoneOtpExpiry:    { type: Date,   select: false },

    // ── نظام التحقق ومستوى الثقة ───────────────────────────
    trustLevel:        { type: Number, min: 1, max: 4, default: 1 },
    trustScore:        { type: Number, default: 70 },
    promotedByAdmin:   { type: Boolean, default: false },
    isVerifiedStudent: { type: Boolean, default: false },
    quota:             { type: Number, default: 2 },
    totalDonations:    { type: Number, default: 0 },
    badges:            { type: [String], default: [] },
    reportedBy:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // ── الحماية وجلسات العمل ──────────────────────────────
    resetPasswordToken:  { type: String, select: false },
    resetPasswordExpire: { type: Date,   select: false },
    refreshToken:        { type: String, select: false },
    sessionIssuedAt:     { type: Date,   select: false },
  },
  { timestamps: true }
);

// ── الفهارس (Indexes) — المرجع الوحيد لكل فهرس ───────────
userSchema.index({ email: 1 },               { unique: true });
userSchema.index({ phone: 1 },               { sparse: true, unique: true });
userSchema.index({ role: 1, isBanned: 1 });
userSchema.index({ trustLevel: 1 });
userSchema.index({ trustScore: -1 });
userSchema.index({ totalDonations: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ resetPasswordToken: 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);
