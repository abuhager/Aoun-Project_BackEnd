const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Item = require('../models/Item');
const Rating = require('../models/Rating');
const SystemSettings = require('../models/SystemSettings');
const { generateOtp } = require('../utils/otp');
const { sendEmail, fireSendEmail } = require('../utils/sendEmail');
const userRepository = require('../repositories/userRepository');
const { buildGamificationProfile } = require('../utils/gamification');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokenUtils');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const isUniversityEmail = async (email) => {
  const settings = await SystemSettings.getCached();
  const domains = settings.universityEmailDomains ?? [];
  return domains.some((domain) => email.toLowerCase().endsWith(domain.toLowerCase()));
};

const buildSafeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  role: user.role,
  trustScore: user.trustScore,
  trustLevel: user.trustLevel ?? 1,
  quota: user.quota,
  isVerified: user.isVerified,
  isVerifiedStudent: user.isVerifiedStudent,
  badges: user.badges,
  createdAt: user.createdAt,
  gamification: buildGamificationProfile(user.trustScore, user.totalDonations),
});

exports.registerLogic = async ({ name, email, password, phone }) => {
  const exists = await userRepository.findByEmail(email);
  if (exists) {
    return { statusCode: 400, body: { msg: 'هذا الإيميل مسجل مسبقاً' } };
  }

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);
  const newOtp = generateOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  const isStudent = await isUniversityEmail(email);

  await userRepository.createUser({
    name,
    email,
    password: hashed,
    phone: phone || undefined,
    verificationOtp: newOtp,
    verificationOtpExpiry: otpExpiry,
    isVerifiedStudent: isStudent,
    trustLevel: isStudent ? 2 : 1,
  });

  fireSendEmail({
    email,
    subject: 'تحقق من إيميلك - منصة عون 📬',
    message: `<div dir="rtl"><h2>مرحباً ${name}!</h2><p>رمز التحقق الخاص بك:</p><h1 style="letter-spacing:8px;color:#006155;">${newOtp}</h1><p style="color:#888;">ينتهي خلال 10 دقائق</p>${isStudent ? '<p style="color:#006155;">✅ تم التحقق من انتمائك الجامعي تلقائياً</p>' : ''}</div>`,
  });

  return {
    statusCode: 201,
    body: {
      msg: 'تم إنشاء الحساب! تحقق من إيميلك 📬',
      email,
      isVerifiedStudent: isStudent,
    },
  };
};

exports.verifyEmailLogic = async ({ email, otp }) => {
  const user = await userRepository.findByEmail(email, { selectOtp: true });

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (user.isVerified) return { statusCode: 400, body: { msg: 'الإيميل محقق مسبقاً ✅' } };
  if (!user.verificationOtpExpiry || Date.now() > user.verificationOtpExpiry.getTime()) {
    return { statusCode: 400, body: { msg: 'انتهت صلاحية رمز التحقق ⏰ — اطلب رمزاً جديداً' } };
  }
  if (user.verificationOtp !== otp) {
    return { statusCode: 400, body: { msg: 'رمز التحقق غير صحيح ❌' } };
  }

  user.isVerified = true;
  user.verificationOtp = undefined;
  user.verificationOtpExpiry = undefined;

  if (await isUniversityEmail(user.email)) {
    user.isVerifiedStudent = true;
    if (!user.trustLevel || user.trustLevel < 2) user.trustLevel = 2;
  }

  await userRepository.saveUser(user);

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const hashedRefresh = hashToken(refreshToken);

  await userRepository.updateUser(user._id, {
    refreshToken: hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg: 'تم التحقق من إيميلك بنجاح ✅',
      user: buildSafeUser(user),
      accessToken,
    },
  };
};

exports.loginLogic = async ({ email, password }) => {
  const user = await userRepository.findByEmailWithPassword(email);

  if (!user) return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور 🚫' } };

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };

  if (!user.isVerified) {
    const newOtp = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await userRepository.updateUser(user._id, {
      verificationOtp: newOtp,
      verificationOtpExpiry: otpExpiry,
    });

    fireSendEmail({
      email,
      subject: 'تحقق من إيميلك - منصة عون 📬',
      message: `<div dir="rtl"><h2>مرحباً ${user.name}!</h2><p>طلبت تسجيل الدخول، لكن حسابك لم يُفعَّل بعد.</p><p>رمز التحقق الجديد الخاص بك:</p><h1 style="letter-spacing:8px;color:#006155;">${newOtp}</h1><p style="color:#888;">ينتهي خلال 10 دقائق</p></div>`,
    });

    return {
      statusCode: 403,
      body: {
        msg: 'حسابك غير مفعّل — تم إرسال رمز تحقق جديد إلى إيميلك 📧',
        code: 'NOT_VERIFIED',
        email: user.email,
      },
    };
  }

  if (await isUniversityEmail(email) && (!user.trustLevel || user.trustLevel < 2)) {
    await userRepository.updateUser(user._id, {
      isVerifiedStudent: true,
      trustLevel: 2,
    });
    user.isVerifiedStudent = true;
    user.trustLevel = 2;
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const hashedRefresh = hashToken(refreshToken);

  await userRepository.updateUser(user._id, {
    refreshToken: hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg: 'مرحباً بعودتك 👋',
      user: buildSafeUser(user),
      accessToken,
    },
  };
};

exports.refreshLogic = async (refreshToken) => {
  if (!refreshToken) {
    return {
      statusCode: 401,
      clearCookie: true,
      body: { msg: 'لا يوجد Refresh Token', code: 'NO_REFRESH' },
    };
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const hashedIncoming = hashToken(refreshToken);
    const user = await userRepository.findByIdWithSession(decoded.user.id);

    if (!user || user.refreshToken !== hashedIncoming) {
      return {
        statusCode: 401,
        clearCookie: true,
        body: { msg: 'الجلسة غير صالحة أو انتُهكت 🚨', code: 'REFRESH_REUSE' },
      };
    }

    if (user.isBanned) {
      return {
        statusCode: 403,
        clearCookie: true,
        body: { msg: 'حسابك محظور 🚫', code: 'BANNED' },
      };
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const newHash = hashToken(newRefreshToken);

    const rotated = await User.findOneAndUpdate(
      { _id: user._id, refreshToken: hashedIncoming },
      { $set: { refreshToken: newHash, sessionIssuedAt: new Date() } },
      { new: true }
    );

    if (!rotated) {
      return {
        statusCode: 401,
        clearCookie: true,
        body: { msg: 'الجلسة غير صالحة أو انتُهكت 🚨', code: 'REFRESH_REUSE' },
      };
    }

    return {
      statusCode: 200,
      newRefreshToken,
      body: { accessToken: newAccessToken },
    };
  } catch {
    return {
      statusCode: 401,
      clearCookie: true,
      body: { msg: 'Refresh Token غير صالح', code: 'INVALID_REFRESH' },
    };
  }
};

exports.logoutLogic = async (userId) => {
  await userRepository.updateUser(userId, {
    refreshToken: undefined,
    sessionIssuedAt: undefined,
  });

  return {
    statusCode: 200,
    clearCookie: true,
    body: { msg: 'تم تسجيل الخروج بنجاح 👋' },
  };
};

exports.getMeLogic = async (userId, page = 1) => {
  const LIMIT = 10;
  const skip = (page - 1) * LIMIT;

  const [user, donations, received, totalRatings, totalDonationsCount, totalReceivedCount] =
    await Promise.all([
      userRepository.findById(userId),
      Item.find({ donor: userId }).populate('bookedBy', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(LIMIT).lean(),
      Item.find({ bookedBy: userId, status: 'تم التسليم' }).populate('donor', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(LIMIT).lean(),
      Rating.countDocuments({ ratee: userId }),
      Item.countDocuments({ donor: userId }),
      Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    ]);

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  return {
    statusCode: 200,
    body: {
      user: buildSafeUser(user),
      stats: {
        donationsCount: totalDonationsCount,
        completedDonations: donations.filter((i) => i.status === 'تم التسليم').length,
        receivedCount: totalReceivedCount,
        totalRatings,
      },
      allDonations: donations,
      completedRequests: received,
      page,
      totalPages: Math.max(
        Math.ceil(totalDonationsCount / LIMIT),
        Math.ceil(totalReceivedCount / LIMIT)
      ),
      hasMore: page * LIMIT < totalDonationsCount || page * LIMIT < totalReceivedCount,
    },
  };
};

exports.getPublicProfileLogic = async (userId, page = 1) => {
  const LIMIT = 10;
  const skip = (page - 1) * LIMIT;

  const [user, donations, received, totalRatings, totalDonationsCount, totalReceivedCount] =
    await Promise.all([
      userRepository.findById(userId),
      Item.find({ donor: userId, status: { $ne: 'مخفي' } }).select('title imageUrl status createdAt').sort({ createdAt: -1 }).skip(skip).limit(LIMIT).lean(),
      Item.find({ bookedBy: userId, status: 'تم التسليم' }).select('title imageUrl status createdAt').sort({ createdAt: -1 }).skip(skip).limit(LIMIT).lean(),
      Rating.countDocuments({ ratee: userId }),
      Item.countDocuments({ donor: userId, status: { $ne: 'مخفي' } }),
      Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    ]);

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور' } };

  return {
    statusCode: 200,
    body: {
      user: {
        name: user.name,
        avatar: user.avatar,
        trustLevel: user.trustLevel ?? 1,
        isVerifiedStudent: user.isVerifiedStudent,
        createdAt: user.createdAt,
        gamification: buildGamificationProfile(user.trustScore, user.totalDonations),
      },
      stats: {
        donationsCount: totalDonationsCount,
        receivedCount: totalReceivedCount,
        totalRatings,
      },
      allDonations: donations,
      completedRequests: received,
      page,
      totalPages: Math.max(
        Math.ceil(totalDonationsCount / LIMIT),
        Math.ceil(totalReceivedCount / LIMIT)
      ),
      hasMore: page * LIMIT < totalDonationsCount || page * LIMIT < totalReceivedCount,
    },
  };
};

exports.forgotPasswordLogic = async (email) => {
  const user = await userRepository.findByEmail(email);

  if (!user) {
    return {
      statusCode: 200,
      body: { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' },
    };
  }

  const resetToken = crypto.randomBytes(20).toString('hex');
  user.resetPasswordToken = hashToken(resetToken);
  user.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
  await userRepository.saveUser(user);

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'استعادة كلمة المرور - منصة عون 🔒',
      message: `<div dir="rtl"><h2>طلب استعادة كلمة المرور</h2><a href="${resetUrl}" style="background:#006155;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:10px;">إعادة تعيين كلمة المرور</a><p style="color:#888;margin-top:10px;">ينتهي الرابط خلال 15 دقيقة</p></div>`,
    });

    return {
      statusCode: 200,
      body: { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' },
    };
  } catch {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await userRepository.saveUser(user);
    return { statusCode: 500, body: { msg: 'حدث خطأ أثناء إرسال البريد الإلكتروني' } };
  }
};

exports.resetPasswordLogic = async (token, newPassword) => {
  const hashedToken = hashToken(token);
  const user = await userRepository.findByResetToken(hashedToken);

  if (!user) {
    return { statusCode: 400, body: { msg: 'الرابط غير صالح أو انتهت صلاحيته ❌' } };
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    return { statusCode: 400, body: { msg: 'يرجى اختيار كلمة مرور جديدة تختلف عن الحالية ❌' } };
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.refreshToken = undefined;
  user.sessionIssuedAt = undefined;
  await userRepository.saveUser(user);

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح! ✅' } };
};

exports.updateMeLogic = async (userId, updates, fileBuffer) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  if (updates.name) user.name = updates.name.trim();
  if (updates.phone) user.phone = updates.phone;

  if (fileBuffer) {
    try {
      const cloudinary = require('../config/cloudinary');
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'aoun/avatars',
            resource_type: 'image',
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
          },
          (err, res) => (err ? reject(err) : resolve(res))
        );
        const { Readable } = require('stream');
        Readable.from(fileBuffer).pipe(stream);
      });
      user.avatar = result.secure_url;
    } catch (uploadErr) {
      console.error('Cloudinary upload error:', uploadErr.message);
    }
  }

  await user.save();

  return {
    statusCode: 200,
    body: {
      msg: 'تم تحديث الملف الشخصي بنجاح ✅',
      user: buildSafeUser(user),
    },
  };
};

exports.updatePasswordLogic = async (userId, currentPassword, newPassword) => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return { statusCode: 400, body: { msg: 'كلمة المرور الحالية غير صحيحة' } };

  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) return { statusCode: 400, body: { msg: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' } };

  const salt = await bcrypt.genSalt(12);
  user.password = await bcrypt.hash(newPassword, salt);
  user.refreshToken = undefined;
  user.sessionIssuedAt = undefined;
  await user.save();

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح ✅' } };
};