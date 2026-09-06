import mongoose from 'mongoose';

const JORDAN_PHONE_REGEX = /^\+9627[789]\d{7}$/;

const userSchema = new mongoose.Schema(
  {
    name:              { type: String, required: true, trim: true },
    email:             { type: String, required: true, trim: true, lowercase: true },
    password:          { type: String, required: true, select: false },
    avatar:            { type: String, default: '' },
    avatarPublicId:    { type: String, default: null, select: false },
    isBanned:          { type: Boolean, default: false },
    isFrozen:          { type: Boolean, default: false },
    banReason:         { type: String, default: null, maxlength: 500 },
    bannedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    role:              { type: String, default: 'user', enum: ['user', 'admin', 'super_admin'] },
    isVerified:        { type: Boolean, default: false },

    // ── OTP الإيميل ──────────────────────────────────────────
    verificationOtp:       { type: String, select: false },
    verificationOtpExpiry: { type: Date,   select: false },
    otpAttempts:           { type: Number, default: 0, select: false },

    // ── OTP الهاتف ─────────────────────────────────────────
    phone: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value: string) => JORDAN_PHONE_REGEX.test(value),
        message: 'رقم الهاتف يجب أن يكون بصيغة دولية أردنية صحيحة (+9627XXXXXXXX)',
      },
    },
    phoneVerified:     { type: Boolean, default: false },
    phoneOtp:          { type: String, select: false },
    phoneOtpExpiry:    { type: Date,   select: false },
    phoneOtpSentAt:    { type: Date,   select: false },

    // ── نظام التحقق ومستوى الثقة ───────────────────────────
    trustLevel:        { type: Number, min: 1, max: 2, default: 1 },
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
    previousRefreshToken: { type: String, select: false },
    previousRefreshTokenExpire: { type: Date, select: false },
    sessionVersion:      { type: Number, default: 0, select: false },
    sessionIssuedAt:     { type: Date,   select: false },
  },
  { timestamps: true }
);

// ── الفهارس (Indexes) ───────────────────────────────────
userSchema.index({ email: 1 }, { unique: true });

// لا نحجز الرقم نهائياً قبل إثبات ملكيته. الفهرس الفريد يطبّق فقط على الأرقام المحققة.
userSchema.index(
  { phone: 1 },
  {
    unique: true,
    name: 'phone_verified_unique',
    partialFilterExpression: { phoneVerified: true },
  }
);

userSchema.index({ role: 1, isBanned: 1 });
userSchema.index({ trustLevel: 1 });
userSchema.index({ trustScore: -1 });
userSchema.index({ totalDonations: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ resetPasswordToken: 1 }, { sparse: true });

// ✅ الـ TTL Index المعتمد على createdAt الثابت
userSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds:    parseInt(process.env.UNVERIFIED_USER_TTL_SECONDS || '86400'),
    partialFilterExpression:   { isVerified: false },
    name:                      'ttl_unverified_users',
  }
);const User = mongoose.model('User', userSchema);
export default User;
