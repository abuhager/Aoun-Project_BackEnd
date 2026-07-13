// services/authService.js — النسخة النهائية المُصلَحة (Flow 3)
// ✅ FIX [BUG-01..04]      : إصلاحات Flow 2 المحفوظة
// ✅ FIX [SEC-AUTH-02]     : Refresh Token Reuse Detection
// ✅ FIX [HC-02/03]        : أبعاد/حجم الصورة ديناميكية
// ✅ FIX [DUP-PROF-01]     : _getProfilePageParams مشتركة — حذف تكرار pagination
// ✅ FIX [DUP-PROF-02]     : phone + phoneVerified في buildSafeUser
// ✅ FIX [PERF-PROF-02]    : حذف .select().lean() المكرر فوق findPublicProfile
// ✅ FIX [SEC-PROF-03]     : توحيد صيغة الهاتف +962 قبل الحفظ في updateMeLogic
// ✅ FIX [STUDENT-UPGRADE] : إصلاح مشكلة الترقية التلقائية للطلاب عند تأكيد الحساب
// ✅ FIX [PHONE-TRUST-02]  : إعادة ضبط phoneVerified و trustLevel عند تغيير الرقم في updateMeLogic

const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const { Readable } = require('stream');
const cloudinary   = require('../config/cloudinary');

const Item           = require('../models/Item');
const Rating         = require('../models/Rating');
const SystemSettings = require('../models/SystemSettings');

const userRepository = require('../repositories/userRepository');
const emailService   = require('./emailService');
const sessionCache   = require('../utils/sessionCache');

const { buildGamificationProfile } = require('../utils/gamification');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/tokenUtils');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp');
const { hashToken } = require('../utils/cryptoUtils');

const BCRYPT_ROUNDS       = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ─── مساعدات ────────────────────────────────────────────────

const isUniversityEmail = async (email) => {
  const settings = await SystemSettings.getCached();
  const domains  = settings?.universityEmailDomains ?? [];
  const lowerEmail = email.toLowerCase().trim();
  return domains.some((d) => lowerEmail.endsWith(d.toLowerCase().trim()));
};

const _upgradeStudentTrust = async (user) => {
  if (!(await isUniversityEmail(user.email))) return;

  user.isVerifiedStudent = true;
  const settings          = await SystemSettings.getCached();
  const studentTrustLevel = settings?.studentDefaultTrustLevel ?? 2;
  const studentQuota      = settings?.studentQuota             ?? 5;
  const defaultQuota      = settings?.defaultUserQuota         ?? 2;

  if ((user.trustLevel ?? 1) < studentTrustLevel) user.trustLevel = studentTrustLevel;
  if ((user.quota ?? defaultQuota) <= defaultQuota) user.quota    = studentQuota;
};

// ✅ FIX [DUP-PROF-02]: phone + phoneVerified مُضافان
const buildSafeUser = (user) => ({
  _id:               user._id,
  name:              user.name,
  email:             user.email,
  phone:             user.phone        ?? null,
  phoneVerified:     user.phoneVerified ?? false,
  avatar:            user.avatar,
  role:              user.role,
  trustScore:        user.trustScore,
  trustLevel:        user.trustLevel ?? 1,
  quota:             user.quota,
  isVerified:        user.isVerified,
  isVerifiedStudent: user.isVerifiedStudent,
  badges:            user.badges,
  createdAt:         user.createdAt,
  gamification:      buildGamificationProfile(user.trustScore, user.totalDonations),
});

// ✅ FIX [DUP-PROF-01]: دالة مشتركة لـ pagination
const _getProfilePageParams = async (page) => {
  const settings = await SystemSettings.getCached();
  const pageSize = settings?.profilePageSize ?? 10;
  return { pageSize, skip: (page - 1) * pageSize, settings };
};

// ─── getCurrentUserLogic ─────────────────────────────────────
exports.getCurrentUserLogic = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' } };
  return { statusCode: 200, body: buildSafeUser(user) };
};

// ─── resendOtpLogic ──────────────────────────────────────────
exports.resendOtpLogic = async ({ email }) => {
  if (!email) return { statusCode: 400, body: { msg: 'البريد الإلكتروني مطلوب' } };

  const user       = await userRepository.findByEmail(email, { selectOtp: true });
  const GENERIC_OK = { statusCode: 200, body: { msg: 'إذا كان الحساب موجوداً وغير مفعّل، ستصلك رسالة قريباً 📧' } };

  if (!user || user.isVerified || user.isBanned) return GENERIC_OK;

  const settings         = await SystemSettings.getCached();
  const otpExpiryMinutes = settings?.otpExpiryMinutes ?? 10;
  const COOLDOWN_MS      = 60 * 1000;
  const totalExpiryMs    = otpExpiryMinutes * 60 * 1000;

  if (
    user.verificationOtpExpiry &&
    user.verificationOtpExpiry.getTime() - Date.now() > (totalExpiryMs - COOLDOWN_MS)
  ) {
    return { statusCode: 429, body: { msg: 'انتظر دقيقة واحدة قبل طلب رمز جديد ⏳', code: 'RESEND_TOO_FAST' } };
  }

  const rawOtp     = generateOtp();
  const otpHash    = hashOtp(rawOtp);
  const expiryTime = new Date(Date.now() + totalExpiryMs);

  await userRepository.updateUser(user._id, {
    verificationOtp:       otpHash,
    verificationOtpExpiry: expiryTime,
    otpAttempts:           0,
  });

  try {
    const isStudent = user.isVerifiedStudent || (await isUniversityEmail(user.email));
    await emailService.sendVerificationEmail(user.email, rawOtp, user.name, isStudent);
  } catch (mailErr) {
    console.error('[Mail Error] resendOtp:', mailErr);
  }

  return GENERIC_OK;
};

// ─── registerLogic ───────────────────────────────────────────
exports.registerLogic = async ({ name, email, password, phone }) => {
  const settings          = await SystemSettings.getCached();
  const otpExpiryMinutes  = settings?.otpExpiryMinutes         ?? 10;
  const defaultQuota      = settings?.defaultUserQuota         ?? 2;
  const studentTrustLevel = settings?.studentDefaultTrustLevel ?? 2;
  const isStudent         = await isUniversityEmail(email);

  const exists = await userRepository.findByEmail(email);

  if (exists) {
    if (exists.isVerified) {
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      return { statusCode: 201, body: { msg: 'تم إنشاء الحساب! تحقق من إيميلك 📬', email, isVerifiedStudent: isStudent } };
    }

    const rawOtp    = generateOtp();
    const otpHash   = hashOtp(rawOtp);
    const otpExpiry = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

    await userRepository.updateUser(exists._id, {
      verificationOtp:       otpHash,
      verificationOtpExpiry: otpExpiry,
      otpAttempts:           0,
      isVerifiedStudent:     isStudent,
      trustLevel:            isStudent ? studentTrustLevel : 1,
      quota:                 isStudent ? (settings?.studentQuota ?? 5) : defaultQuota,
    });

    await emailService.sendVerificationEmail(email, rawOtp, exists.name, isStudent);
    return { statusCode: 201, body: { msg: 'تم إنشاء الحساب! تحقق من إيميلك 📬', email, isVerifiedStudent: isStudent } };
  }

  const hashed    = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const rawOtp    = generateOtp();
  const otpHash   = hashOtp(rawOtp);
  const otpExpiry = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

  await userRepository.createUser({
    name,
    email,
    password:              hashed,
    phone:                 phone || undefined,
    verificationOtp:       otpHash,
    verificationOtpExpiry: otpExpiry,
    otpAttempts:           0,
    isVerifiedStudent:     isStudent,
    trustLevel:            isStudent ? studentTrustLevel : 1,
    quota:                 isStudent ? (settings?.studentQuota ?? 5) : defaultQuota,
  });

  await emailService.sendVerificationEmail(email, rawOtp, name, isStudent);
  return { statusCode: 201, body: { msg: 'تم إنشاء الحساب! تحقق من إيميلك 📬', email, isVerifiedStudent: isStudent } };
};

// ─── verifyEmailLogic ────────────────────────────────────────
exports.verifyEmailLogic = async ({ email, otp }) => {
  const settings    = await SystemSettings.getCached();
  const maxAttempts = settings?.maxOtpAttempts ?? 5;

  const user = await userRepository.findAndIncrementOtpAttempts(email, maxAttempts);

  if (!user) {
    const checkUser = await userRepository.findEmailStatus(email);
    if (!checkUser)           return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
    if (checkUser.isVerified) return { statusCode: 400, body: { msg: 'الإيميل محقق مسبقاً ✅' } };
    await userRepository.resetOtpAttemptsAfterLock(email);
    return { statusCode: 429, body: { msg: 'تجاوزت الحد المسموح من المحاولات، اطلب رمزاً جديداً 🔒', code: 'OTP_ATTEMPTS_EXCEEDED' } };
  }

  if (!user.verificationOtp || !user.verificationOtpExpiry) {
    return { statusCode: 400, body: { msg: 'لا يوجد رمز تحقق نشط، اطلب رمزاً جديداً' } };
  }

  if (new Date(user.verificationOtpExpiry).getTime() < Date.now()) {
    return { statusCode: 400, body: { msg: 'انتهت صلاحية رمز التحقق ⏰ — اطلب رمزاً جديداً', code: 'OTP_EXPIRED' } };
  }

  const isValid = verifyOtp(otp, user.verificationOtp);
  if (!isValid) {
    const remaining = maxAttempts - user.otpAttempts;
    return { statusCode: 400, body: { msg: `رمز التحقق غير صحيح ❌ (${Math.max(0, remaining)} محاولة متبقية)` } };
  }

  const mutableUser = { ...user };
  await _upgradeStudentTrust(mutableUser);

  const accessToken                                     = generateAccessToken(mutableUser);
  const { token: refreshToken, hashed: hashedRefresh }  = generateRefreshToken(mutableUser);

  const updatedUser = await userRepository.atomicVerifyAndComplete(user._id, user.verificationOtp, {
    $set: {
      isVerified:        true,
      isVerifiedStudent: mutableUser.isVerifiedStudent,
      trustLevel:        mutableUser.trustLevel,
      quota:             mutableUser.quota,
      otpAttempts:       0,
      refreshToken:      hashedRefresh,
      sessionIssuedAt:   new Date(),
    },
    $unset: { verificationOtp: 1, verificationOtpExpiry: 1 },
  });

  if (!updatedUser) {
    return { statusCode: 409, body: { msg: 'تم التحقق مسبقاً أو الرمز غير صالح 🔄' } };
  }

  return {
    statusCode: 200,
    refreshToken,
    body: { msg: 'تم التحقق من إيميلك بنجاح ✅', user: buildSafeUser(updatedUser), accessToken },
  };
};

// ─── loginLogic ──────────────────────────────────────────────
exports.loginLogic = async ({ email, password }) => {
  const user = await userRepository.findByEmailWithPassword(email);

  if (!user) return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور 🚫', code: 'ACCOUNT_BANNED' } };

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };

  if (!user.isVerified) {
    const settings         = await SystemSettings.getCached();
    const otpExpiryMinutes = settings?.otpExpiryMinutes ?? 10;
    const maxOtpAttempts   = settings?.maxOtpAttempts   ?? 5;
    const COOLDOWN_MS      = 60 * 1000;
    const totalExpiryMs    = otpExpiryMinutes * 60 * 1000;

    const hasActiveOtp = user.verificationOtpExpiry &&
      user.verificationOtpExpiry.getTime() - Date.now() > (totalExpiryMs - COOLDOWN_MS);

    if (hasActiveOtp) {
      if ((user.otpAttempts ?? 0) >= maxOtpAttempts) {
        return {
          statusCode: 429,
          body: { msg: 'تجاوزت الحد المسموح — اطلب رمزاً جديداً عبر إعادة الإرسال 🔒', code: 'OTP_ATTEMPTS_EXCEEDED', email: user.email },
        };
      }
      return {
        statusCode: 403,
        body: { msg: 'حسابك غير مفعّل — تحقق من بريدك، الرمز المُرسل لا يزال صالحاً ⏳', code: 'EMAIL_NOT_VERIFIED', email: user.email },
      };
    }

    const rawOtp    = generateOtp();
    const otpHash   = hashOtp(rawOtp);
    const otpExpiry = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

    await userRepository.updateUser(user._id, {
      verificationOtp:       otpHash,
      verificationOtpExpiry: otpExpiry,
      otpAttempts:           0,
    });

    await emailService.sendVerificationEmail(email, rawOtp, user.name, await isUniversityEmail(email));

    return {
      statusCode: 403,
      body: { msg: 'حسابك غير مفعّل — تم إرسال رمز تحقق جديد إلى إيميلك 📧', code: 'EMAIL_NOT_VERIFIED', email: user.email },
    };
  }

  const beforeLevel = user.trustLevel ?? 1;
  const beforeQuota = user.quota      ?? 2;
  await _upgradeStudentTrust(user);

  if (user.trustLevel !== beforeLevel || user.quota !== beforeQuota || user.isVerifiedStudent) {
    await userRepository.updateUser(user._id, {
      isVerifiedStudent: user.isVerifiedStudent,
      trustLevel:        user.trustLevel,
      quota:             user.quota,
    });
  }

  const accessToken                                    = generateAccessToken(user);
  const { token: refreshToken, hashed: hashedRefresh } = generateRefreshToken(user);

  await userRepository.updateUser(user._id, {
    refreshToken:    hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  return {
    statusCode: 200,
    refreshToken,
    body: { msg: 'مرحباً بعودتك 👋', user: buildSafeUser(user), accessToken },
  };
};

// ─── refreshLogic ─────────────────────────────────────────────
exports.refreshLogic = async (rawRefreshToken, clientIp = 'unknown') => {
  if (!rawRefreshToken) {
    return { statusCode: 401, clearCookie: true, body: { msg: 'لا يوجد Refresh Token 🔒', code: 'NO_REFRESH_TOKEN' } };
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch (err) {
    return {
      statusCode: 401,
      clearCookie: true,
      body: {
        msg:  err.name === 'TokenExpiredError' ? 'انتهت صلاحية الجلسة، أعد تسجيل الدخول ⏰' : 'Refresh Token غير صالح ⚠️',
        code: err.name === 'TokenExpiredError' ? 'REFRESH_TOKEN_EXPIRED' : 'INVALID_REFRESH_TOKEN',
      },
    };
  }

  const userId = decoded?.user?.id;
  if (!userId) {
    return { statusCode: 401, clearCookie: true, body: { msg: 'Refresh Token تالف', code: 'MALFORMED_TOKEN' } };
  }

  const hashedIncoming = hashToken(rawRefreshToken);
  const user           = await userRepository.findByIdWithRefreshToken(userId);

  if (!user) {
    return { statusCode: 401, clearCookie: true, body: { msg: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' } };
  }

  if (user.isBanned) {
    sessionCache.invalidate(userId);
    return { statusCode: 403, clearCookie: true, body: { msg: 'حسابك محظور 🚫', code: 'ACCOUNT_BANNED' } };
  }

  if (!user.refreshToken || user.refreshToken !== hashedIncoming) {
    await userRepository.invalidateUserSession(userId);
    sessionCache.invalidate(userId);
    console.warn(`[SEC-AUTH-02] Token Reuse — userId: ${userId} — IP: ${clientIp}`);
    return {
      statusCode: 401,
      clearCookie: true,
      body: { msg: 'اكتُشف نشاط مشبوه — تم تسجيل خروجك من جميع الأجهزة 🛡️', code: 'TOKEN_REUSE_DETECTED' },
    };
  }

  const { token: newRefreshToken, hashed: newHashedRefresh } = generateRefreshToken(user);
  const newIssuedAt = new Date();

  const updatedUser = await userRepository.rotateRefreshToken(userId, hashedIncoming, newHashedRefresh, newIssuedAt);

  if (!updatedUser) {
    return { statusCode: 409, clearCookie: false, body: { msg: 'تعارض في التحديث، أعد المحاولة 🔄', code: 'ROTATION_CONFLICT' } };
  }

  sessionCache.set(userId, newIssuedAt);
  const newAccessToken = generateAccessToken(updatedUser);

  return {
    statusCode: 200,
    newRefreshToken,
    body: { msg: 'تم تجديد الجلسة ✅', accessToken: newAccessToken, user: buildSafeUser(updatedUser) },
  };
};

// ─── logoutLogic ──────────────────────────────────────────────
exports.logoutLogic = async (userId) => {
  sessionCache.invalidate(userId);
  await userRepository.updateUser(userId, {
    refreshToken:    undefined,
    sessionIssuedAt: undefined,
  });
  return { statusCode: 200, clearCookie: true, body: { msg: 'تم تسجيل الخروج بنجاح 👋' } };
};

// ─── getMeLogic ───────────────────────────────────────────────
exports.getMeLogic = async (userId, page = 1) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const { pageSize, skip } = await _getProfilePageParams(page);

  const [
    donations, received, totalRatings,
    totalDonationsCount, totalReceivedCount, completedDonationsCount,
  ] = await Promise.all([
    Item.find({ donor: userId }).populate('bookedBy', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Item.find({ bookedBy: userId, status: 'تم التسليم' }).populate('donor', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Rating.countDocuments({ ratee: userId }),
    Item.countDocuments({ donor: userId }),
    Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    Item.countDocuments({ donor: userId,  status: 'تم التسليم' }),
  ]);

  const donationsTotalPages = Math.ceil(totalDonationsCount / pageSize);
  const receivedTotalPages  = Math.ceil(totalReceivedCount  / pageSize);

  return {
    statusCode: 200,
    body: {
      user: buildSafeUser(user),
      stats: { donationsCount: totalDonationsCount, completedDonations: completedDonationsCount, receivedCount: totalReceivedCount, totalRatings },
      allDonations:      donations,
      completedRequests: received,
      pagination: {
        currentPage: page, limit: pageSize,
        donations: { totalItems: totalDonationsCount, totalPages: donationsTotalPages, hasMore: page < donationsTotalPages },
        received:  { totalItems: totalReceivedCount,  totalPages: receivedTotalPages,  hasMore: page < receivedTotalPages  },
      },
    },
  };
};

// ─── getPublicProfileLogic ────────────────────────────────────
exports.getPublicProfileLogic = async (userId, page = 1) => {
  const userCheck = await userRepository.findPublicProfile(userId);

  if (!userCheck) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (userCheck.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور' } };

  const { pageSize, skip } = await _getProfilePageParams(page);

  const [donations, received, totalRatings, totalDonationsCount, totalReceivedCount] = await Promise.all([
    Item.find({ donor: userId, status: { $ne: 'مخفي' } }).select('title imageUrl status createdAt').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Item.find({ bookedBy: userId, status: 'تم التسليم' }).select('title imageUrl status createdAt').sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Rating.countDocuments({ ratee: userId }),
    Item.countDocuments({ donor: userId, status: { $ne: 'مخفي' } }),
    Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
  ]);

  return {
    statusCode: 200,
    body: {
      user: {
        name:              userCheck.name,
        avatar:            userCheck.avatar,
        trustLevel:        userCheck.trustLevel ?? 1,
        isVerifiedStudent: userCheck.isVerifiedStudent,
        createdAt:         userCheck.createdAt,
        gamification:      buildGamificationProfile(userCheck.trustScore, userCheck.totalDonations),
      },
      stats: { donationsCount: totalDonationsCount, receivedCount: totalReceivedCount, totalRatings },
      allDonations:      donations,
      completedRequests: received,
      pagination: {
        currentPage: page, limit: pageSize,
        donations: { totalItems: totalDonationsCount, totalPages: Math.ceil(totalDonationsCount / pageSize), hasMore: page < Math.ceil(totalDonationsCount / pageSize) },
        received:  { totalItems: totalReceivedCount,  totalPages: Math.ceil(totalReceivedCount  / pageSize), hasMore: page < Math.ceil(totalReceivedCount  / pageSize) },
      },
    },
  };
};

// ─── forgotPasswordLogic ──────────────────────────────────────
exports.forgotPasswordLogic = async ({ email }) => {
  const user        = await userRepository.findByEmail(email);
  const GENERIC_MSG = { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' };

  if (!user) return { statusCode: 200, body: GENERIC_MSG };

  const settings           = await SystemSettings.getCached();
  const resetExpiryMinutes = settings?.resetPasswordExpiryMinutes ?? 15;

  const resetToken       = crypto.randomBytes(32).toString('hex');
  const hashedResetToken = hashToken(resetToken);
  const resetExpire      = Date.now() + resetExpiryMinutes * 60 * 1000;

  await userRepository.updateUser(user._id, {
    resetPasswordToken:  hashedResetToken,
    resetPasswordExpire: resetExpire,
  });

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl  = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await emailService.sendResetPasswordEmail(user.email, resetToken, user.name, resetUrl);
    return { statusCode: 200, body: GENERIC_MSG };
  } catch (err) {
    console.error('[forgotPassword] CRITICAL: Email failed for user:', user._id, err.message);
    await userRepository.updateUser(user._id, {
      $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 },
    });
    return { statusCode: 500, body: { msg: 'حدث خطأ أثناء إرسال البريد الإلكتروني، حاول مجدداً لاحقاً ⚠️' } };
  }
};

// ─── resetPasswordLogic ───────────────────────────────────────
exports.resetPasswordLogic = async (token, newPassword) => {
  const hashedToken = hashToken(token);
  const user        = await userRepository.findByResetToken(hashedToken);

  if (!user) return { statusCode: 400, body: { msg: 'الرابط غير صالح أو انتهت صلاحيته ❌' } };

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) return { statusCode: 400, body: { msg: 'يرجى اختيار كلمة مرور جديدة تختلف عن الحالية ❌' } };

  user.password            = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.resetPasswordToken  = undefined;
  user.resetPasswordExpire = undefined;
  user.refreshToken        = undefined;
  user.sessionIssuedAt     = undefined;
  await userRepository.saveUser(user);

  sessionCache.invalidate(user._id.toString());
  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح! ✅' } };
};

// ─── updateMeLogic ────────────────────────────────────────────
exports.updateMeLogic = async (userId, updates, fileBuffer, mimetype) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const settings       = await SystemSettings.getCached();
  const maxAvatarMB    = settings?.maxAvatarSizeMb ?? 5;
  const maxAvatarBytes = maxAvatarMB * 1024 * 1024;
  const avatarWidth    = settings?.avatarWidth  ?? 400;
  const avatarHeight   = settings?.avatarHeight ?? 400;

  if (updates.name) user.name = updates.name.trim();

  // ✅ FIX [PHONE-TRUST-02]: إعادة ضبط phoneVerified و trustLevel عند تغيير الرقم
  let phoneChanged = false;
  if (updates.phone) {
    let phone = updates.phone.replace(/[\s\-]/g, '');
    phone     = phone.replace(/^(00962|\+962|0)/, '');
    const normalizedPhone = `+962${phone}`;

    const phoneExists = await userRepository.findByPhoneExcluding(normalizedPhone, userId);
    if (phoneExists) {
      return { statusCode: 409, body: { msg: 'رقم الهاتف مستخدم من قِبَل حساب آخر ❌', code: 'PHONE_ALREADY_EXISTS' } };
    }

    // تحقق هل الرقم تغيّر فعلاً
    if (user.phone !== normalizedPhone) {
      phoneChanged  = true;
      user.phone    = normalizedPhone;
    }
  }

  if (fileBuffer) {
    if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      return { statusCode: 400, body: { msg: 'نوع الصورة غير مدعوم، يُسمح بـ JPEG أو PNG أو WebP فقط 🖼️' } };
    }
    if (fileBuffer.length > maxAvatarBytes) {
      return { statusCode: 400, body: { msg: `حجم الصورة يتجاوز الحد المسموح (${maxAvatarMB} ميغابايت) 🖼️` } };
    }
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder:        'hajah/avatars',
            resource_type: 'image',
            transformation: [{ width: avatarWidth, height: avatarHeight, crop: 'fill', gravity: 'face' }],
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

  // بناء حقول التحديث
  const updateFields = {
    name:   user.name,
    phone:  user.phone,
    avatar: user.avatar,
  };

  // ✅ FIX [PHONE-TRUST-02]: إذا تغيّر الرقم — اسحب الثقة حتى يُعاد التحقق
  if (phoneChanged) {
    updateFields.phoneVerified = false;
    // إذا لم يكن طالباً موثقاً — يرجع المستوى لـ 1
    if (!user.isVerifiedStudent) {
      updateFields.trustLevel = 1;
    }
  }

  const updatedUser = await userRepository.updateUser(userId, updateFields);

  return {
    statusCode: 200,
    body: {
      msg:          'تم تحديث الملف الشخصي بنجاح ✅',
      user:         buildSafeUser(updatedUser),
      phoneChanged, // يُعلم الـ Frontend إن كان لازم يطلب تحقق الرقم
    },
  };
};

// ─── updatePasswordLogic ──────────────────────────────────────
exports.updatePasswordLogic = async (userId, { currentPassword, newPassword }) => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return { statusCode: 400, body: { msg: 'كلمة المرور الحالية غير صحيحة' } };

  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) return { statusCode: 400, body: { msg: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' } };

  const newHashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await userRepository.updateUser(userId, {
    password:        newHashedPassword,
    refreshToken:    undefined,
    sessionIssuedAt: undefined,
  });

  sessionCache.invalidate(userId);
  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح ✅' } };
};
