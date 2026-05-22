const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, index: true },

    password: { type: String, required: true, select: false },

    phone:    { type: String },
    reportedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    avatar:   { type: String, default: "" },
    isBanned: { type: Boolean, default: false },

    resetPasswordToken:  String,
    resetPasswordExpire: Date,

    role: {
      type:    String,
      default: "user",
      enum:    ["user", "admin", "super_admin"],
    },

    isVerified:      { type: Boolean, default: false },
    verificationOtp: { type: String, select: false }, // ✅ أضف select: false — لا يُرجع في الـ responses

    isVerifiedStudent: { type: Boolean, default: false },
    trustScore:        { type: Number, default: 70 },
    quota:             { type: Number, default: 2 },

    refreshToken:   { type: String, select: false },
    sessionIssuedAt: { type: Date, select: false },

    totalDonations: { type: Number, default: 0 },
    badges:         { type: [String], default: [] },

    // ✅ جديد — Phase 2 Trust System
    trustLevel: {
      type:    Number,
      enum:    [1, 2],
      default: 1,
    },

    phoneVerified: {
      type:    Boolean,
      default: false,
    },

    promotedByAdmin: {
      type:    Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);