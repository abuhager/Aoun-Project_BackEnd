// models/User.js
// ✅ Phase 1: Bug #3 — verificationOtpExpiry
// ✅ Phase 2: إضافة phoneOtp + phoneOtpExpiry لنظام التحقق عبر WhatsApp

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // ─── البيانات الأساسية ────────────────────────────────────
    name:  { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true },

    password: { type: String, required: true, select: false },

    avatar:   { type: String, default: '' },
    isBanned: { type: Boolean, default: false },

    role: {
      type:    String,
      default: 'user',
      enum:    ['user', 'admin', 'super_admin'],
    },

    // ─── تحقق الإيميل ────────────────────────────────────────
    isVerified:            { type: Boolean, default: false },
    verificationOtp:       { type: String, select: false },
    verificationOtpExpiry: { type: Date,   select: false },

    // ─── تحقق الهاتف (Phase 2 — WhatsApp OTP) ───────────────
    // phoneOtp + phoneOtpExpiry: select: false — لا يُرسَلان أبداً في الـ Response
    phone:             { type: String,  default: null },
    phoneVerified:     { type: Boolean, default: false },
    phoneOtp:          { type: String,  select: false },     // ✅ جديد
    phoneOtpExpiry:    { type: Date,    select: false },     // ✅ جديد

    // ─── نظام الثقة (4 مستويات) ──────────────────────────────
    // Level 1: مسجّل + إيميل متحقق (isVerified = true)
    // Level 2 Auto:   isVerifiedStudent = true (إيميل جامعي)
    // Level 2 Manual: phoneVerified = true (WhatsApp OTP)
    // Level 2 Exception: promotedByAdmin = true
    trustLevel: {
      type:    Number,
      enum:    [1, 2],
      default: 1,
    },
    trustScore:      { type: Number,  default: 70 },
    promotedByAdmin: { type: Boolean, default: false },
    isVerifiedStudent: { type: Boolean, default: false },

    // ─── الحصة والنشاط ───────────────────────────────────────
    quota:          { type: Number,   default: 2 },
    totalDonations: { type: Number,   default: 0 },
    badges:         { type: [String], default: [] },

    // ─── بلاغات ──────────────────────────────────────────────
    reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // ─── إعادة تعيين كلمة المرور ─────────────────────────────
    resetPasswordToken:  { type: String, select: false },
    resetPasswordExpire: { type: Date,   select: false },

    // ─── الجلسة ───────────────────────────────────────────────
    refreshToken:    { type: String, select: false },
    sessionIssuedAt: { type: Date,   select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);