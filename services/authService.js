// services/authService.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Readable } = require('stream');
const cloudinary = require('../config/cloudinary'); // ✅ إصلاح #5: الاستيراد في الأعلى وليس داخل الدوال

const User = require('../models/User');
const Item = require('../models/Item');
const Rating = require('../models/Rating');
const SystemSettings = require('../models/SystemSettings');

const userRepository = require('../repositories/userRepository');
const { sendEmail, fireSendEmail } = require('../utils/sendEmail'); // مستخدم لإرسال الإيميلات بـ الرابط والـ OTP
const { buildGamificationProfile } = require('../utils/gamification');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/tokenUtils');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp'); // ✅ أدوات الـ OTP الآمنة

// ✅ إصلاح #3: توحيد جولات التشفير من البيئة أو افتراضي 12 لمنع التضارب
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ── دالت مساعدّة لتوليد وتدقيق التوكنات والتحقق الجامعي ────────────────
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const isUniversityEmail = async (email) => {
  const settings = await SystemSettings.getCached();
  const domains = settings.universityEmailDomains ?? [];
  return domains.some((domain) => email.toLowerCase().endsWith(domain.toLowerCase()));
};

// ✅ إصلاح #6: دالة موحدة لترقية مستوى ثقة الطلاب لمنع تكرار الكود عبر التسجيل والتحقق واللوجن
const _upgradeStudentTrust = async (user) => {
  if (user.isVerifiedStudent) return;
  if (await isUniversityEmail(user.email)) {
    user.isVerifiedStudent = true;
    if ((user.trustLevel ?? 1) < 2) user.trustLevel = 2;
  }
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

// ── registerLogic ─────────────────────────────────────────────
exports.registerLogic = async ({ name, email, password, phone }) => {
  const exists = await userRepository.findByEmail(email);
  if (exists) {
    return { statusCode: 409, body: { msg: 'هذا الإيميل مسجل مسبقاً' } }; // 409 Conflict أنسب
  }

  // ✅ إصلاح #3: تشفير بـ BCRYPT_ROUNDS الموحدة
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // ✅ إصلاح #2: توليد OTP آمن وتخزينه كـ Hash (SHA-256) لحمايته بقاعدة البيانات
  const rawOtp = generateOtp();
  const otpHash = hashOtp(rawOtp);
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  const isStudent = await isUniversityEmail(email);

  const newUser = await userRepository.createUser({
    name,
    email,
    password: hashed,
    phone: phone || undefined,
    verificationOtp: otpHash, // الـ Hash
    verificationOtpExpiry: otpExpiry,
    otpAttempts: 0, // ✅ إصلاح #4: تصفير العداد عند الإنشاء
    isVerifiedStudent: isStudent,
    trustLevel: isStudent ? 2 : 1,
  });

  // إرسال الرمز الصريح (rawOtp) للمستخدم عبر الإيميل وليس الـ Hash
  await emailService.sendVerificationEmail(email, rawOtp, name, isStudent);

  return {
    statusCode: 201,
    body: {
      msg: 'تم إنشاء الحساب! تحقق من إيميلك 📬',
      email,
      isVerifiedStudent: isStudent,
    },
  };
};

// ── verifyEmailLogic ──────────────────────────────────────────
exports.verifyEmailLogic = async ({ email, otp }) => {
  // جلب الحقول المخفية والمحمية الخاصة بالتحقق والمحاولات
  const user = await userRepository.findByEmail(email, {
    select: '+verificationOtp +verificationOtpExpiry +otpAttempts',
  });

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (user.isVerified) return { statusCode: 400, body: { msg: 'الإيميل محقق مسبقاً ✅' } };
  
  if (!user.verificationOtp || !user.verificationOtpExpiry) {
    return { statusCode: 400, body: { msg: 'لا يوجد رمز تحقق نشط، اطلب رمزاً جديداً' } };
  }
  
  if (user.verificationOtpExpiry.getTime() < Date.now()) {
    return { statusCode: 400, body: { msg: 'انتهت صلاحية رمز التحقق ⏰ — اطلب رمزاً جديداً', code: 'OTP_EXPIRED' } };
  }

  // ✅ إصلاح #4: فحص عداد المحاولات وتدمير الرمز وقفل الجلسة إذا تجاوز 5 محاولات لمنع هجوم التخمين
  if ((user.otpAttempts ?? 0) >= 5) {
    user.verificationOtp = undefined;
    user.verificationOtpExpiry = undefined;
    user.otpAttempts = 0;
    await userRepository.saveUser(user);
    return {
      statusCode: 429,
      body: { msg: 'تجاوزت الحد المسموح من المحاولات، اطلب رمزاً جديداً 🔒', code: 'OTP_ATTEMPTS_EXCEEDED' },
    };
  }

  // ✅ إصلاح #2: مقارنة الـ OTP باستخدام Timing-safe comparison عبر الـ Hash
  const isValid = verifyOtp(otp, user.verificationOtp);

  if (!isValid) {
    user.otpAttempts = (user.otpAttempts ?? 0) + 1;
    await userRepository.saveUser(user);
    const remaining = 5 - user.otpAttempts;
    return {
      statusCode: 400,
      body: { msg: `رمز التحقق غير صحيح ❌ (${remaining} محاولة متبقية)` },
    };
  }

  // تنظيف حقول التحقق بعد النجاح
  user.isVerified = true;
  user.verificationOtp = undefined;
  user.verificationOtpExpiry = undefined;
  user.otpAttempts = 0;

  // ✅ إصلاح #6: استدعاء الدالة الموحدة
  await _upgradeStudentTrust(user);
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

// ── loginLogic ────────────────────────────────────────────────
exports.loginLogic = async ({ email, password }) => {
  const user = await userRepository.findByEmailWithPassword(email);

  if (!user) return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور 🚫', code: 'ACCOUNT_BANNED' } };

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };

  if (!user.isVerified) {
    const rawOtp = generateOtp();
    const otpHash = hashOtp(rawOtp);
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await userRepository.updateUser(user._id, {
      verificationOtp: otpHash,
      verificationOtpExpiry: otpExpiry,
      otpAttempts: 0,
    });

    await emailService.sendVerificationEmail(email, rawOtp, user.name, await isUniversityEmail(email));

    return {
      statusCode: 403,
      body: {
        msg: 'حسابك غير مفعّل — تم إرسال رمز تحقق جديد إلى إيميلك 📧',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      },
    };
  }

  // ✅ إصلاح #6: استدعاء الدالة المشتركة للترقية والتحقق الجامعي عند تسجيل الدخول
  await _upgradeStudentTrust(user);
  if (user.isModified && user.isModified('trustLevel')) {
    await userRepository.updateUser(user._id, {
      isVerifiedStudent: user.isVerifiedStudent,
      trustLevel: user.trustLevel,
    });
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

// ── refreshLogic ──────────────────────────────────────────────
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

// ── logoutLogic ───────────────────────────────────────────────
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

// ── getMeLogic ────────────────────────────────────────────────
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

// ── getPublicProfileLogic ─────────────────────────────────────
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

// ── forgotPasswordLogic ───────────────────────────────────────
exports.forgotPasswordLogic = async (email) => {
  const user = await userRepository.findByEmail(email);

  // ✅ إصلاح #9: توحيد الرسالة المرتجعة للكل لمنع كشف وجود البريد الإلكتروني (User Enumeration Vuln)
  const GENERIC_MSG = { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' };

  if (!user) {
    return { statusCode: 200, body: GENERIC_MSG };
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = hashToken(resetToken);
  user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 دقيقة
  await userRepository.saveUser(user);

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await emailService.sendResetPasswordEmail(user.email, resetToken, user.name, resetUrl);
    return { statusCode: 200, body: GENERIC_MSG };
  } catch (err) {
    // ✅ إصلاح #9: تسجيل الخطأ داخلياً وعدم تسريب تفاصيل السيرفر للمهاجم مع إعادة تعيين الـ tokens
    console.error('[forgotPassword] Email sending failed:', err.message);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await userRepository.saveUser(user);
    return { statusCode: 200, body: GENERIC_MSG }; 
  }
};

// ── resetPasswordLogic ────────────────────────────────────────
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

  // ✅ إصلاح #3: التشفير بـ BCRYPT_ROUNDS الثابتة والموحدة بدلاً من الترقيم العشوائي
  user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.refreshToken = undefined;
  user.sessionIssuedAt = undefined;
  await userRepository.saveUser(user);

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح! ✅' } };
};

// ── updateMeLogic ─────────────────────────────────────────────
exports.updateMeLogic = async (userId, updates, fileBuffer, mimetype) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  if (updates.name) user.name = updates.name.trim();
  if (updates.phone) user.phone = updates.phone;

  if (fileBuffer) {
    // ✅ إصلاح #5: التحقق الفعلي من نوع الـ Mimetype لـ الحماية قبل الرفع إلى Cloudinary
    if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      return {
        statusCode: 400,
        body: { msg: 'نوع الصورة غير مدعوم، يُسمح بـ JPEG أو PNG أو WebP فقط 🖼️' },
      };
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'hajah/avatars',
            resource_type: 'image',
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
          },
          (err, res) => (err ? reject(err) : resolve(res))
        );
        Readable.from(fileBuffer).pipe(stream);
      });
      user.avatar = result.secure_url;
    } catch (uploadErr) {
      console.error('Cloudinary upload error:', uploadErr.message);
      return { statusCode: 500, body: { msg: 'فشل رفع الصورة الشخصية' } };
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

// ── updatePasswordLogic ───────────────────────────────────────
exports.updatePasswordLogic = async (userId, currentPassword, newPassword) => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return { statusCode: 400, body: { msg: 'كلمة المرور الحالية غير صحيحة' } };

  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) return { statusCode: 400, body: { msg: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' } };

  // ✅ إصلاح #3: تطبيق الـ BCRYPT_ROUNDS الموحدة من الـ Environment هنا أيضاً
  user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.refreshToken = undefined;
  user.sessionIssuedAt = undefined;
  await user.save();

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح ✅' } };
};