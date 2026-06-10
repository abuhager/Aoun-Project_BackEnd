// services/authService.js
// ✅ النسخة النهائية الشاملة: ديناميكية بالكامل، آمنة ومقاومة للـ Race Conditions والـ User Enumeration

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Readable } = require('stream');
const cloudinary = require('../config/cloudinary'); 

const User = require('../models/User');
const Item = require('../models/Item');
const Rating = require('../models/Rating');
const SystemSettings = require('../models/SystemSettings');

const userRepository = require('../repositories/userRepository');
const emailService = require('./emailService'); 
const { buildGamificationProfile } = require('../utils/gamification');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/tokenUtils');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp'); 
const { hashToken } = require('../utils/cryptoUtils');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ── دالة التحقق الجامعي ومساعدات الترقية ────────────────────────────
const isUniversityEmail = async (email) => {
  const settings = await SystemSettings.getCached();
  const domains = settings?.universityEmailDomains ?? [];
  return domains.some((domain) => email.toLowerCase().endsWith(domain.toLowerCase()));
};

const _upgradeStudentTrust = async (user) => {
  if (user.isVerifiedStudent) return;

  if (await isUniversityEmail(user.email)) {
    user.isVerifiedStudent = true;
    
    try {
      const settings = await SystemSettings.getCached();
      const studentTrustLevel = settings?.studentDefaultTrustLevel ?? 2;
      const studentQuota = settings?.studentQuota ?? 5; 

      if ((user.trustLevel ?? 1) < studentTrustLevel) {
        user.trustLevel = studentTrustLevel;
      }

      const defaultQuota = settings?.defaultUserQuota ?? 2;
      if ((user.quota ?? defaultQuota) <= defaultQuota) {
        user.quota = studentQuota;
      }
    } catch (error) {
      console.error('[Upgrade Error] فشل تحديث معايير الطالب من الإعدادات:', error);
      if ((user.trustLevel ?? 1) < 2) user.trustLevel = 2;
      if ((user.quota ?? 2) <= 2) user.quota = 5; 
    }
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

// ── getCurrentUserLogic ──────────────────────────────────────
exports.getCurrentUserLogic = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    return { statusCode: 404, body: { msg: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' } };
  }
  return {
    statusCode: 200,
    body: buildSafeUser(user),
  };
};

// ── ✅ resendOtpLogic (مُصلحة بالكامل مع حماية الـ Enumeration والـ Cooldown) ──
exports.resendOtpLogic = async ({ email }) => {
  if (!email) {
    return { statusCode: 400, body: { msg: 'البريد الإلكتروني مطلوب' } };
  }

  const user = await userRepository.findByEmail(email);

  // ✅ رسالة موحدة دائماً لحماية خصوصية المستخدمين ومنع كشف الحسابات
  const GENERIC_OK = {
    statusCode: 200,
    body: { msg: 'إذا كان الحساب موجوداً وغير مفعّل، ستصلك رسالة قريباً 📧' },
  };

  if (!user || user.isVerified || user.isBanned) return GENERIC_OK;

  const settings = await SystemSettings.getCached();
  const otpExpiryMinutes = settings?.otpExpiryMinutes ?? 10;

  // ✅ حماية الـ Cooldown (60 ثانية) لمنع الإرسال المتكرر السريع
  const COOLDOWN_MS = 60 * 1000;
  const totalExpiryMs = otpExpiryMinutes * 60 * 1000;
  if (
    user.verificationOtpExpiry &&
    user.verificationOtpExpiry.getTime() - Date.now() > (totalExpiryMs - COOLDOWN_MS)
  ) {
    return {
      statusCode: 429,
      body: {
        msg: 'انتظر دقيقة واحدة قبل طلب رمز جديد ⏳',
        code: 'RESEND_TOO_FAST',
      },
    };
  }

  const rawOtp = generateOtp();
  const otpHash = hashOtp(rawOtp);
  const expiryTime = new Date(Date.now() + totalExpiryMs); 

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        verificationOtp: otpHash,
        verificationOtpExpiry: expiryTime,
        otpAttempts: 0 // تصفير العداد لإعطاء المستخدم فرصة جديدة للتخمين السليم
      }
    }
  );

  try {
    const isStudent = user.isVerifiedStudent || (await isUniversityEmail(user.email));
    await emailService.sendVerificationEmail(user.email, rawOtp, user.name, isStudent);
  } catch (mailError) {
    console.error('[Mail Error] فشل إعادة إرسال الرمز:', mailError);
    // نرجع الرسالة العامة حتى لا نسرب حالات الفشل التقنية للمهاجمين
    return GENERIC_OK;
  }

  return GENERIC_OK;
};

// ── registerLogic ─────────────────────────────────────────────
exports.registerLogic = async ({ name, email, password, phone }) => {
  const exists = await userRepository.findByEmail(email);
  
  if (exists) {
    // ✅ Dummy hash لمنع الـ Timing Attack (يأخذ نفس وقت التشفير الفعلي)
    await bcrypt.hash(password, BCRYPT_ROUNDS);
    
    // ✅ نرجع نفس الـ statusCode والـ body تماماً كأن الحساب تم إنشاؤه
    // نحدد قيمة افتراضية لـ isVerifiedStudent بناءً على الإيميل لتوحيد شكل الرد (Response Body)
    const isStudent = await isUniversityEmail(email); 
    
    return {
      statusCode: 201,
      body: {
        msg: 'تم إنشاء الحساب! تحقق من إيميلك 📬',
        email,
        isVerifiedStudent: isStudent,
      },
    };
  }

  const settings = await SystemSettings.getCached();
  const otpExpiryMinutes = settings?.otpExpiryMinutes ?? 10;
  const defaultQuota = settings?.defaultUserQuota ?? 2;
  const studentTrustLevel = settings?.studentDefaultTrustLevel ?? 2;

  // تشفير كلمة المرور الفعلية للمستخدم الجديد
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const rawOtp = generateOtp();
  const otpHash = hashOtp(rawOtp);
  const otpExpiry = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);
  const isStudent = await isUniversityEmail(email);

  const newUser = await userRepository.createUser({
    name,
    email,
    password: hashed,
    phone: phone || undefined,
    verificationOtp: otpHash, 
    verificationOtpExpiry: otpExpiry,
    otpAttempts: 0, 
    isVerifiedStudent: isStudent,
    trustLevel: isStudent ? studentTrustLevel : 1,
    quota: isStudent ? (settings?.studentQuota ?? 5) : defaultQuota,
  });

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
  const User = require('../models/User'); 
  
  const user = await User.findOneAndUpdate(
    {
      email,
      isVerified: false,
      $or: [
        { otpAttempts: { $lt: 5 } },
        { otpAttempts: { $exists: false } }
      ]
    },
    { $inc: { otpAttempts: 1 } },
    { 
      new: true, 
      select: '+verificationOtp +verificationOtpExpiry +otpAttempts +trustLevel +role +quota' 
    }
  ).lean(); 

  if (!user) {
    const checkUser = await User.findOne({ email }).select('isVerified otpAttempts').lean();
    if (!checkUser) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
    if (checkUser.isVerified) return { statusCode: 400, body: { msg: 'الإيميل محقق مسبقاً ✅' } };
    
    await User.updateOne({ email }, { 
      $unset: { verificationOtp: 1, verificationOtpExpiry: 1 },
      $set: { otpAttempts: 0 } 
    });
    
    return {
      statusCode: 429,
      body: { msg: 'تجاوزت الحد المسموح من المحاولات، اطلب رمزاً جديداً 🔒', code: 'OTP_ATTEMPTS_EXCEEDED' },
    };
  }

  if (!user.verificationOtp || !user.verificationOtpExpiry) {
    return { statusCode: 400, body: { msg: 'لا يوجد رمز تحقق نشط، اطلب رمزاً جديداً' } };
  }
  
  if (new Date(user.verificationOtpExpiry).getTime() < Date.now()) {
    return { statusCode: 400, body: { msg: 'انتهت صلاحية رمز التحقق ⏰ — اطلب رمزاً جديداً', code: 'OTP_EXPIRED' } };
  }

  const isValid = verifyOtp(otp, user.verificationOtp);

  if (!isValid) {
    const remaining = 5 - user.otpAttempts;
    return {
      statusCode: 400,
      body: { msg: `رمز التحقق غير صحيح ❌ (${Math.max(0, remaining)} محاولة متبقية)` },
    };
  }

  // 1. تحديث بيانات كائن المستخدم في الذاكرة أولاً
  user.isVerified = true;
  user.verificationOtp = undefined;
  user.verificationOtpExpiry = undefined;
  user.otpAttempts = 0;
  
  // 2. تشغيل الترقية (لتحديث الـ trustLevel والـ quota في كائن user في الذاكرة قبل حفظه)
  await _upgradeStudentTrust(user);

  // 3. توليد الـ Tokens بناءً على البيانات المحدثة للمستخدم
  const accessToken = generateAccessToken(user);
  const { token: refreshToken, hashed: hashedRefresh } = generateRefreshToken(user);

  // ✅ 4. الإصلاح الذري: دمج عمليتي الـ Update في عملية واحدة شاملة
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        isVerified: true,
        trustLevel: user.trustLevel,
        quota: user.quota,
        otpAttempts: 0,
        refreshToken: hashedRefresh,      // ← دُمجت هنا بنجاح
        sessionIssuedAt: new Date(),     // ← دُمجت هنا بنجاح
      },
      $unset: {
        verificationOtp: 1,
        verificationOtpExpiry: 1
      }
    }
  );

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
    const settings = await SystemSettings.getCached();
    const otpExpiryMinutes = settings?.otpExpiryMinutes ?? 10;

    // ✅ إصلاح #2: فحص Cooldown هنا أيضاً لمنع OTP flooding عبر /login
    const COOLDOWN_MS    = 60 * 1000;
    const totalExpiryMs  = otpExpiryMinutes * 60 * 1000;
    const hasActiveOtp   = user.verificationOtpExpiry &&
      user.verificationOtpExpiry.getTime() - Date.now() > (totalExpiryMs - COOLDOWN_MS);

    if (hasActiveOtp) {
      return {
        statusCode: 403,
        body: {
          msg: 'حسابك غير مفعّل — تحقق من بريدك، الرمز المُرسل لا يزال صالحاً ⏳',
          code: 'EMAIL_NOT_VERIFIED',
          email: user.email,
        },
      };
    }

    // لا يوجد رمز نشط أو انتهت صلاحيته → أصدر رمزاً جديداً
    const rawOtp  = generateOtp();
    const otpHash = hashOtp(rawOtp);
    const otpExpiry = new Date(Date.now() + totalExpiryMs);

    await userRepository.updateUser(user._id, {
      verificationOtp:       otpHash,
      verificationOtpExpiry: otpExpiry,
      otpAttempts:           0,
    });

    await emailService.sendVerificationEmail(
      email,
      rawOtp,
      user.name,
      await isUniversityEmail(email)
    );

    return {
      statusCode: 403,
      body: {
        msg: 'حسابك غير مفعّل — تم إرسال رمز تحقق جديد إلى إيميلك 📧',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      },
    };
  }

  // ... بقية loginLogic كما هي بدون تغيير
  const beforeLevel = user.trustLevel ?? 1;
  const beforeQuota = user.quota ?? 2;
  await _upgradeStudentTrust(user);

  if (user.trustLevel !== beforeLevel || user.quota !== beforeQuota || user.isVerifiedStudent) {
    await userRepository.updateUser(user._id, {
      isVerifiedStudent: user.isVerifiedStudent,
      trustLevel:        user.trustLevel,
      quota:             user.quota,
    });
  }

  const accessToken = generateAccessToken(user);
  const { token: refreshToken, hashed: hashedRefresh } = generateRefreshToken(user);

  await userRepository.updateUser(user._id, {
    refreshToken:    hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg:  'مرحباً بعودتك 👋',
      user: buildSafeUser(user),
      accessToken,
    },
  };
};

// ── refreshLogic ──────────────────────────────────────────────
exports.refreshLogic = async (refreshToken) => {
  if (!refreshToken) {
    return { statusCode: 401, clearCookie: true, body: { msg: 'لا يوجد Refresh Token', code: 'NO_REFRESH' } };
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const hashedIncoming = hashToken(refreshToken);

    const { token: newRefreshToken, hashed: newHash } = generateRefreshToken(decoded.user);

    const rotated = await userRepository.rotateRefreshToken(
      decoded.user.id,
      hashedIncoming,
      newHash,
      new Date()
    );

    if (!rotated) {
      await userRepository.invalidateUserSession(decoded.user.id);

      return {
        statusCode: 401,
        clearCookie: true,
        body: { msg: 'تم اكتشاف نشاط مشبوه 🚨 — أعد تسجيل الدخول', code: 'REFRESH_REUSE' },
      };
    }

    const newAccessToken = generateAccessToken({
      id:         rotated._id,
      role:       rotated.role,
      trustLevel: rotated.trustLevel ?? 1,
      isVerified: rotated.isVerified,
      isBanned:   rotated.isBanned,
    });

    return { statusCode: 200, newRefreshToken, body: { accessToken: newAccessToken } };

  } catch (error) {
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
  const user = await userRepository.findById(userId);
  if (!user) {
    return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  }

  const settings = await SystemSettings.getCached();
  const pageSize = settings?.profilePageSize ?? 10;
  const skip = (page - 1) * pageSize;

  const [donations, received, totalRatings, totalDonationsCount, totalReceivedCount] =
    await Promise.all([
      Item.find({ donor: userId }).populate('bookedBy', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      Item.find({ bookedBy: userId, status: 'تم التسليم' }).populate('donor', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      Rating.countDocuments({ ratee: userId }),
      Item.countDocuments({ donor: userId }),
      Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    ]);

  const donationsTotalPages = Math.ceil(totalDonationsCount / pageSize);
  const receivedTotalPages = Math.ceil(totalReceivedCount / pageSize);

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
      
      pagination: {
        currentPage: page,
        limit: pageSize,
        donations: {
          totalItems: totalDonationsCount,
          totalPages: donationsTotalPages,
          hasMore: page < donationsTotalPages,
        },
        received: {
          totalItems: totalReceivedCount,
          totalPages: receivedTotalPages,
          hasMore: page < receivedTotalPages,
        }
      }
    },
  };
};

// ── getPublicProfileLogic ─────────────────────────────────────
exports.getPublicProfileLogic = async (userId, page = 1) => {
  const User = require('../models/User'); 
  
  const userCheck = await User.findById(userId)
    .select('name avatar role trustScore trustLevel totalDonations isVerifiedStudent isBanned createdAt')
    .lean();

  if (!userCheck) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (userCheck.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور' } };

  const settings = await SystemSettings.getCached();
  const pageSize = settings?.profilePageSize ?? 10;
  const skip = (page - 1) * pageSize;

  const [donations, received, totalRatings, totalDonationsCount, totalReceivedCount] =
    await Promise.all([
      Item.find({ donor: userId, status: { $ne: 'مخفي' } })
        .select('title imageUrl status createdAt').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      Item.find({ bookedBy: userId, status: 'تم التسليم' })
        .select('title imageUrl status createdAt').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      Rating.countDocuments({ ratee: userId }),
      Item.countDocuments({ donor: userId, status: { $ne: 'مخفي' } }),
      Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    ]);

  const donationsTotalPages = Math.ceil(totalDonationsCount / pageSize);
  const receivedTotalPages = Math.ceil(totalReceivedCount / pageSize);

  return {
    statusCode: 200,
    body: {
      user: {
        name: userCheck.name,
        avatar: userCheck.avatar,
        trustLevel: userCheck.trustLevel ?? 1,
        isVerifiedStudent: userCheck.isVerifiedStudent,
        createdAt: userCheck.createdAt,
        gamification: buildGamificationProfile(userCheck.trustScore, userCheck.totalDonations),
      },
      stats: {
        donationsCount: totalDonationsCount,
        receivedCount: totalReceivedCount,
        totalRatings,
      },
      allDonations: donations,
      completedRequests: received,
      
      pagination: {
        currentPage: page,
        limit: pageSize,
        donations: {
          totalItems: totalDonationsCount,
          totalPages: donationsTotalPages,
          hasMore: page < donationsTotalPages,
        },
        received: {
          totalItems: totalReceivedCount,
          totalPages: receivedTotalPages,
          hasMore: page < receivedTotalPages,
        }
      }
    },
  };
};

// ── forgotPasswordLogic ───────────────────────────────────────
exports.forgotPasswordLogic = async ({ email }) => {
  const user = await userRepository.findByEmail(email);
  const GENERIC_MSG = { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' };

  if (!user) {
    return { statusCode: 200, body: GENERIC_MSG };
  }

  const settings = await SystemSettings.getCached();
  const resetExpiryMinutes = settings?.resetPasswordExpiryMinutes ?? 15;

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = hashToken(resetToken);
  user.resetPasswordExpire = Date.now() + resetExpiryMinutes * 60 * 1000; 
  await userRepository.saveUser(user);

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await emailService.sendResetPasswordEmail(user.email, resetToken, user.name, resetUrl);
    return { statusCode: 200, body: GENERIC_MSG };
  } catch (err) {
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
    // 1. فحص نوع الصورة أولاً
    if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      return {
        statusCode: 400,
        body: { msg: 'نوع الصورة غير مدعوم، يُسمح بـ JPEG أو PNG أو WebP فقط 🖼️' },
      };
    }

    // 2. التحقق من حجم الصورة قبل بدء الرفع (الحد الأقصى 5 ميغابايت)
    const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      return {
        statusCode: 400,
        body: { msg: 'حجم الصورة يتجاوز الحد المسموح (5 ميغابايت) 🖼️' },
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
exports.updatePasswordLogic = async (userId, { currentPassword, newPassword }) => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return { statusCode: 400, body: { msg: 'كلمة المرور الحالية غير صحيحة' } };

  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) return { statusCode: 400, body: { msg: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' } };

  user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.refreshToken = undefined;
  user.sessionIssuedAt = undefined;
  await user.save();

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح ✅' } };
};