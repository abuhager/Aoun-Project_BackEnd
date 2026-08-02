// services/authService.js
// ═══════════════════════════════════════════════════════════════════
// سجل الإصلاحات الكاملة:
//
// ── الجولة الحالية ──────────────────────────────────────────────
// ✅ [SEC-NEW-01]   registerLogic  — Generic message + fire-and-forget OTP
// ✅ [SEC-NEW-02]   loginLogic     — إصدار accessToken من DB بعد التحقق من الحفظ
// ✅ [SEC-NEW-03]   resendOtpLogic — فحص isFrozen إضافةً لـ isBanned
// ✅ [PERF-NEW-01]  _upgradeStudentTrust — تقبل settings parameter بدل getCached مزدوج
// ✅ [PERF-NEW-02]  getMeLogic     — safePage لمنع skip عالٍ جداً (الآن في Controller)
// ✅ [LOGIC-NEW-01] verifyEmailLogic — user.toObject() بدل spread على Mongoose document
// ✅ [LOGIC-NEW-02] refreshLogic   — فحص isVerified قبل إصدار tokens جديدة
// ✅ [LOGIC-NEW-03] loginLogic     — فحص otpAttempts قبل إرسال OTP لمنع lockout bypass
// ✅ [DUP-NEW-01]   _issueVerificationOtp — دالة مشتركة تحذف تكرار 3 أماكن
// ✅ [ARCH-NEW-02]  buildSafeUser  — إضافة isFrozen + isBanned
// ✅ [HC-NEW-01]    BCRYPT_ROUNDS  — فحص نطاق [10,14]
//
// ── جولات سابقة محفوظة ──────────────────────────────────────────
// ✅ [BUG-01..04]      إصلاحات Flow 2
// ✅ [SEC-AUTH-02]     Refresh Token Reuse Detection + IP logging
// ✅ [HC-02/03]        أبعاد الصورة ديناميكية من SystemSettings
// ✅ [DUP-PROF-01]     _getProfilePageParams مشتركة
// ✅ [PERF-PROF-02]    حذف .select().lean() المكرر
// ✅ [SEC-PROF-03]     توحيد صيغة الهاتف +962
// ✅ [STUDENT-UPGRADE] إصلاح الترقية التلقائية للطلاب
// ✅ [PHONE-TRUST-02]  إعادة ضبط phoneVerified عند تغيير الرقم
// ═══════════════════════════════════════════════════════════════════

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

// ✅ [HC-NEW-01] نطاق [10,14] — أقل من 10 خطر أمني، أكثر من 14 بطء مفرط
const _rawBcrypt    = parseInt(process.env.BCRYPT_ROUNDS, 10);
const BCRYPT_ROUNDS = (_rawBcrypt >= 10 && _rawBcrypt <= 14) ? _rawBcrypt : 12;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ─── مساعدات خاصة ────────────────────────────────────────────────

const isUniversityEmail = async (email) => {
  const settings = await SystemSettings.getCached();
  const domains  = settings?.universityEmailDomains ?? [];
  const lower    = email.toLowerCase().trim();
  return domains.some((d) => lower.endsWith(d.toLowerCase().trim()));
};

// ✅ [PERF-NEW-01] settings كـ parameter — تمنع getCached مزدوج في loginLogic
const _upgradeStudentTrust = async (user, settings) => {
  const cfg = settings ?? await SystemSettings.getCached();
  if (!(await isUniversityEmail(user.email))) return;

  user.isVerifiedStudent = true;
  const studentTrustLevel = cfg?.studentDefaultTrustLevel ?? 2;
  const studentQuota      = cfg?.studentQuota             ?? 5;
  const defaultQuota      = cfg?.defaultUserQuota         ?? 2;

  if ((user.trustLevel ?? 1) < studentTrustLevel) user.trustLevel = studentTrustLevel;
  if ((user.quota ?? defaultQuota) <= defaultQuota) user.quota    = studentQuota;
};

// ✅ [ARCH-NEW-02] isFrozen + isBanned — الـ Frontend يحتاجهما لعرض حالة الحساب
const buildSafeUser = (user) => ({
  _id:               user._id,
  name:              user.name,
  email:             user.email,
  phone:             user.phone          ?? null,
  phoneVerified:     user.phoneVerified   ?? false,
  avatar:            user.avatar,
  role:              user.role,
  trustScore:        user.trustScore,
  trustLevel:        user.trustLevel     ?? 1,
  quota:             user.quota,
  isVerified:        user.isVerified,
  isVerifiedStudent: user.isVerifiedStudent,
  isBanned:          user.isBanned       ?? false,
  isFrozen:          user.isFrozen       ?? false,
  badges:            user.badges,
  createdAt:         user.createdAt,
  gamification:      buildGamificationProfile(user.trustScore, user.totalDonations),
});

const _getProfilePageParams = async (page) => {
  const settings = await SystemSettings.getCached();
  const pageSize = settings?.profilePageSize ?? 10;
  return { pageSize, skip: (page - 1) * pageSize, settings };
};

// ✅ [DUP-NEW-01] دالة مشتركة لإصدار OTP — تُزيل التكرار من 3 أماكن
// fire-and-forget للبريد: لا ننتظر الإرسال حتى لا نُعطّل الاستجابة
const _issueVerificationOtp = async (userId, email, name, isStudent, otpExpiryMinutes, extraFields = {}) => {
  const rawOtp    = generateOtp();
  const otpHash   = hashOtp(rawOtp);
  const otpExpiry = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

  await userRepository.updateUser(userId, {
    verificationOtp:       otpHash,
    verificationOtpExpiry: otpExpiry,
    otpAttempts:           0,
    ...extraFields,
  });

  emailService.sendVerificationEmail(email, rawOtp, name, isStudent)
    .catch((err) => console.error('[Mail Error] _issueVerificationOtp:', err.message));
};

// ─── getCurrentUserLogic ──────────────────────────────────────────
exports.getCurrentUserLogic = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' } };
  return { statusCode: 200, body: buildSafeUser(user) };
};

// ─── resendOtpLogic ───────────────────────────────────────────────
exports.resendOtpLogic = async ({ email }) => {
  if (!email) return { statusCode: 400, body: { msg: 'البريد الإلكتروني مطلوب' } };

  const user       = await userRepository.findByEmail(email, { selectOtp: true });
  const GENERIC_OK = { statusCode: 200, body: { msg: 'إذا كان الحساب موجوداً وغير مفعّل، ستصلك رسالة قريباً 📧' } };

  // ✅ [SEC-NEW-03] isFrozen — الحساب المجمَّد لا يحق له طلب OTP جديد
  if (!user || user.isVerified || user.isBanned || user.isFrozen) return GENERIC_OK;

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

  const isStudent = user.isVerifiedStudent || (await isUniversityEmail(user.email));
  await _issueVerificationOtp(user._id, user.email, user.name, isStudent, otpExpiryMinutes);

  return GENERIC_OK;
};

// ─── registerLogic ────────────────────────────────────────────────
exports.registerLogic = async ({ name, email, password, phone }) => {
  const settings          = await SystemSettings.getCached();
  const otpExpiryMinutes  = settings?.otpExpiryMinutes         ?? 10;
  const defaultQuota      = settings?.defaultUserQuota         ?? 2;
  const studentTrustLevel = settings?.studentDefaultTrustLevel ?? 2;
  const isStudent         = await isUniversityEmail(email);

  // ✅ [SEC-NEW-01] رسالة موحَّدة — المهاجم لا يعرف إن كان الإيميل مسجَّلاً أم لا
  const GENERIC_REGISTER_RESPONSE = {
    statusCode: 201,
    body: { msg: 'إذا كان الإيميل جديداً، ستصلك رسالة تفعيل قريباً 📬', email, isVerifiedStudent: isStudent },
  };

  const exists = await userRepository.findByEmail(email);

  if (exists) {
    if (exists.isVerified) {
      // تأخير وهمي لمنع Timing Attack — لا نُخبر المهاجم بالحالة
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      return GENERIC_REGISTER_RESPONSE;
    }

    // مستخدم موجود لكن غير مُفعَّل — OTP في الخلفية بدون await عمداً
    const extraFields = {
      isVerifiedStudent: isStudent,
      trustLevel:        isStudent ? studentTrustLevel : 1,
      quota:             isStudent ? (settings?.studentQuota ?? 5) : defaultQuota,
    };
    _issueVerificationOtp(exists._id, exists.email, exists.name, isStudent, otpExpiryMinutes, extraFields);
    return GENERIC_REGISTER_RESPONSE;
  }

  // مستخدم جديد تماماً
  const hashed  = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const newUser = await userRepository.createUser({
    name,
    email,
    password:          hashed,
    phone:             phone || undefined,
    otpAttempts:       0,
    isVerifiedStudent: isStudent,
    trustLevel:        isStudent ? studentTrustLevel : 1,
    quota:             isStudent ? (settings?.studentQuota ?? 5) : defaultQuota,
  });

  _issueVerificationOtp(newUser._id, email, name, isStudent, otpExpiryMinutes);

  return GENERIC_REGISTER_RESPONSE;
};

// ─── verifyEmailLogic ─────────────────────────────────────────────
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

  // ✅ [LOGIC-NEW-01] toObject() لإنتاج plain JS object نظيف من Mongoose document
  const mutableUser = user.toObject ? user.toObject() : { ...user };

  // ✅ [PERF-NEW-01] نمرر settings المُحمَّلة مسبقاً
  await _upgradeStudentTrust(mutableUser, settings);

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

// ─── loginLogic ───────────────────────────────────────────────────
exports.loginLogic = async ({ email, password }) => {
  const user = await userRepository.findByEmailWithPassword(email);

  if (!user)        return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };
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
        body: { msg: 'حسابك غير مفعّل — الرمز المُرسل لا يزال صالحاً ⏳', code: 'EMAIL_NOT_VERIFIED', email: user.email },
      };
    }

    // ✅ [LOGIC-NEW-03] فحص otpAttempts قبل إرسال OTP جديد
    // بدون هذا: OTP جديد يُعيد ضبط otpAttempts=0 → Brute Force متكرر بلا حدود
    if ((user.otpAttempts ?? 0) >= maxOtpAttempts) {
      return {
        statusCode: 429,
        body: { msg: 'تجاوزت الحد المسموح — انتظر وحاول لاحقاً 🔒', code: 'OTP_ATTEMPTS_EXCEEDED', email: user.email },
      };
    }

    const isStudent = await isUniversityEmail(email);
    await _issueVerificationOtp(user._id, email, user.name, isStudent, otpExpiryMinutes);

    return {
      statusCode: 403,
      body: { msg: 'حسابك غير مفعّل — تم إرسال رمز تحقق جديد 📧', code: 'EMAIL_NOT_VERIFIED', email: user.email },
    };
  }

  // ✅ [PERF-NEW-01] getCached مرة واحدة ونمررها
  const settings    = await SystemSettings.getCached();
  const beforeLevel = user.trustLevel ?? 1;
  const beforeQuota = user.quota      ?? 2;
  await _upgradeStudentTrust(user, settings);

  // ✅ [SEC-NEW-02] نحفظ في DB أولاً ونُصدر التوكن من النتيجة المحفوظة
  const needsUpdate = user.trustLevel !== beforeLevel ||
                      user.quota      !== beforeQuota ||
                      user.isVerifiedStudent;

  let finalUser = user;
  if (needsUpdate) {
    const saved = await userRepository.updateUser(user._id, {
      isVerifiedStudent: user.isVerifiedStudent,
      trustLevel:        user.trustLevel,
      quota:             user.quota,
    });
    if (saved) finalUser = saved;
    else console.error('[SEC-NEW-02] فشل حفظ ترقية student:', user._id);
  }

  const accessToken                                    = generateAccessToken(finalUser);
  const { token: refreshToken, hashed: hashedRefresh } = generateRefreshToken(finalUser);

  const savedSession = await userRepository.updateUser(finalUser._id, {
    refreshToken:    hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  if (!savedSession) {
    return { statusCode: 500, body: { msg: 'خطأ في حفظ الجلسة، حاول مجدداً ⚠️', code: 'SESSION_SAVE_FAILED' } };
  }

  return {
    statusCode: 200,
    refreshToken,
    body: { msg: 'مرحباً بعودتك 👋', user: buildSafeUser(finalUser), accessToken },
  };
};

// ─── refreshLogic ─────────────────────────────────────────────────
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
        msg:  err.name === 'TokenExpiredError'
          ? 'انتهت صلاحية الجلسة، أعد تسجيل الدخول ⏰'
          : 'Refresh Token غير صالح ⚠️',
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

  // ✅ [LOGIC-NEW-02] فحص isVerified — سجَّل لكن لم يُفعِّل → لا يجب أن يجدد التوكن
  if (!user.isVerified) {
    await userRepository.invalidateUserSession(userId);
    return { statusCode: 403, clearCookie: true, body: { msg: 'الحساب غير مُفعَّل، يرجى التحقق من بريدك 📧', code: 'ACCOUNT_NOT_VERIFIED' } };
  }

  // ✅ [SEC-REPO-02] isFrozen الآن محمَّل من DB (أُصلح في userRepository)
  if (user.isFrozen) {
    sessionCache.invalidate(userId);
    return { statusCode: 403, clearCookie: true, body: { msg: 'حسابك مجمَّد مؤقتاً 🧊', code: 'ACCOUNT_FROZEN' } };
  }

  if (!user.refreshToken) {
    return { statusCode: 401, clearCookie: true, body: { msg: 'الجلسة منتهية، أعد تسجيل الدخول', code: 'SESSION_EXPIRED' } };
  }

  const isTokenMatch = crypto.timingSafeEqual(
    Buffer.from(hashedIncoming,   'hex'),
    Buffer.from(user.refreshToken,'hex')
  );

  if (!isTokenMatch) {
    // ⚠️ Reuse Detection — إبطال الجلسة + تسجيل IP المشبوه
    console.warn(`[SEC-AUTH-02] Refresh Token Reuse مشبوه — userId: ${userId} — IP: ${clientIp}`);
    await userRepository.invalidateUserSession(userId);
    sessionCache.invalidate(userId);
    return { statusCode: 401, clearCookie: true, body: { msg: 'جلسة مشبوهة، أعد تسجيل الدخول 🔐', code: 'TOKEN_REUSE_DETECTED' } };
  }

  const { token: newRefreshToken, hashed: newHashed } = generateRefreshToken(user);
  const rotated = await userRepository.rotateRefreshToken(userId, user.refreshToken, newHashed, new Date());

  if (!rotated) {
    return { statusCode: 409, clearCookie: true, body: { msg: 'تعارض في تجديد الجلسة، أعد المحاولة', code: 'ROTATION_CONFLICT' } };
  }

  const newAccessToken = generateAccessToken(rotated);
  sessionCache.invalidate(userId);

  return {
    statusCode:      200,
    newRefreshToken,
    body: { accessToken: newAccessToken, user: buildSafeUser(rotated) },
  };
};

// ─── logoutLogic ──────────────────────────────────────────────────
exports.logoutLogic = async (userId) => {
  await userRepository.invalidateUserSession(userId);
  sessionCache.invalidate(userId);
  return { statusCode: 200, body: { msg: 'تم تسجيل الخروج بنجاح 👋' } };
};

// ─── forgotPasswordLogic ──────────────────────────────────────────
exports.forgotPasswordLogic = async ({ email }) => {
  const GENERIC = { statusCode: 200, body: { msg: 'إذا كان الإيميل مسجَّلاً، ستصلك رسالة لإعادة تعيين كلمة المرور 📧' } };
  const user    = await userRepository.findByEmail(email);
  if (!user || !user.isVerified || user.isBanned) return GENERIC;

  const rawToken    = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashToken(rawToken);

  await userRepository.updateUser(user._id, {
    resetPasswordToken:  hashedToken,
    resetPasswordExpire: Date.now() + 15 * 60 * 1000, // 15 دقيقة
  });

  emailService.sendPasswordResetEmail(email, rawToken, user.name)
    .catch((err) => console.error('[Mail Error] forgotPassword:', err.message));

  return GENERIC;
};

// ─── resetPasswordLogic ───────────────────────────────────────────
// ✅ [FLOW2-FIX-02] sessionIssuedAt تُحدَّث بـ new Date() بدل الحذف
// السبب: invalidateUserSession يعمل $unset → sessionIssuedAt = null
//         وهذا يجعل فحص decoded.iat < sessionIssuedAt لا يُفعَّل أبداً
//         لأن null لا تُقارَن بـ timestamp → access tokens تظل صالحة!
exports.resetPasswordLogic = async (token, newPassword) => {
  if (!token || !newPassword) {
    return { statusCode: 400, body: { msg: 'التوكن وكلمة المرور الجديدة مطلوبان' } };
  }

  const hashedToken = hashToken(token);
  const user        = await userRepository.findByResetToken(hashedToken);

  if (!user) {
    return { statusCode: 400, body: { msg: 'الرابط غير صالح أو منتهي الصلاحية ⏰', code: 'INVALID_RESET_TOKEN' } };
  }

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // ✅ [FLOW2-FIX-02] updateUser بـ sessionIssuedAt: new Date() بدل invalidateUserSession المنفصل
  // هذا يضمن: كل access tokens صادرة قبل هذه اللحظة تصبح غير صالحة فوراً
  // لأن requireAuth يفحص: decoded.iat < sessionIssuedAt
  await userRepository.updateUser(user._id, {
    password:        hashed,
    sessionIssuedAt: new Date(), // ← يُبطل كل access tokens السابقة على كل الأجهزة
    $unset: {
      resetPasswordToken:  1,
      resetPasswordExpire: 1,
      refreshToken:        1, // حذف refreshToken لإجبار إعادة تسجيل دخول كامل
    },
  });

  sessionCache.invalidate(user._id.toString());

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح ✅ — أعد تسجيل الدخول' } };
};


// ─── updateMeLogic ────────────────────────────────────────────────
exports.updateMeLogic = async (userId, updates, fileBuffer, fileMimeType) => {
  const settings     = await SystemSettings.getCached();
  const maxImageSize = settings?.maxAvatarSizeBytes ?? 2 * 1024 * 1024;
  const maxWidth     = settings?.maxAvatarWidth      ?? 400;
  const maxHeight    = settings?.maxAvatarHeight     ?? 400;

  if (fileBuffer) {
    if (!ALLOWED_IMAGE_TYPES.includes(fileMimeType)) {
      return { statusCode: 400, body: { msg: 'نوع الملف غير مدعوم — يُسمح بـ JPEG وPNG وWebP فقط' } };
    }
    if (fileBuffer.length > maxImageSize) {
      return { statusCode: 400, body: { msg: `حجم الصورة يتجاوز الحد المسموح (${Math.round(maxImageSize / 1024)}KB)` } };
    }
  }

  if (updates.phone) {
    const existing = await userRepository.findByPhoneExcluding(updates.phone, userId);
    if (existing) {
      return { statusCode: 409, body: { msg: 'رقم الهاتف مستخدم من قِبَل حساب آخر ⚠️', code: 'PHONE_ALREADY_USED' } };
    }
    updates.phoneVerified = false; // إعادة ضبط التحقق عند تغيير الرقم
  }

  if (fileBuffer) {
    const stream   = Readable.from(fileBuffer);
    const imageUrl = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'avatars', width: maxWidth, height: maxHeight, crop: 'fill' },
        (err, result) => err ? reject(err) : resolve(result.secure_url)
      );
      stream.pipe(uploadStream);
    });
    updates.avatar = imageUrl;
  }

  const updated = await userRepository.updateUser(userId, updates);
  if (!updated) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  return { statusCode: 200, body: { msg: 'تم تحديث الملف الشخصي بنجاح ✅', user: buildSafeUser(updated) } };
};

// ─── updatePasswordLogic ──────────────────────────────────────────
// ✅ [FLOW2-FIX-03] sessionIssuedAt تُحدَّث بـ new Date() — نفس منطق resetPassword
exports.updatePasswordLogic = async (userId, { currentPassword, newPassword }) => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return { statusCode: 401, body: { msg: 'كلمة المرور الحالية غير صحيحة ❌' } };

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // ✅ [FLOW2-FIX-03] دمج في استدعاء واحد + sessionIssuedAt يُبطل tokens القديمة
  // المشكلة القديمة: updateUser(password) ثم invalidateUserSession يحذف sessionIssuedAt
  //                  فيترك access tokens نشطة على أجهزة أخرى حتى انتهاء TTL
  await userRepository.updateUser(userId, {
    password:        hashed,
    sessionIssuedAt: new Date(), // ← يُبطل access tokens على جميع الأجهزة فوراً
    $unset: { refreshToken: 1 }, // إجبار إعادة تسجيل دخول على كل الأجهزة
  });

  sessionCache.invalidate(userId.toString());

  return {
    statusCode: 200,
    body: { msg: 'تم تغيير كلمة المرور بنجاح ✅ — ستحتاج إعادة تسجيل الدخول على الأجهزة الأخرى' },
  };
};

// ─── getMeLogic ───────────────────────────────────────────────────
// ✅ [FLOW2-FIX-04] إضافة countDocuments في Promise.all لدعم pagination كامل
exports.getMeLogic = async (userId, page) => {
  const { pageSize, skip } = await _getProfilePageParams(page);

  const [user, donationsResult, receivedResult, donationsTotal, receivedTotal] =
    await Promise.all([
      userRepository.findById(userId),
      Item.find({ donor: userId, status: { $ne: 'draft' } })
        .sort({ createdAt: -1 }).skip(skip).limit(pageSize)
        .select('title category status images createdAt').lean(),
      Item.find({ recipient: userId, status: 'delivered' })
        .sort({ deliveredAt: -1 }).skip(skip).limit(pageSize)
        .select('title category images deliveredAt').lean(),
      // ✅ [FLOW2-FIX-04] countDocuments متوازيان — لا overhead إضافي يُذكر
      Item.countDocuments({ donor: userId, status: { $ne: 'draft' } }),
      Item.countDocuments({ recipient: userId, status: 'delivered' }),
    ]);

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const totalDonationPages = Math.ceil(donationsTotal / pageSize);
  const totalReceivedPages = Math.ceil(receivedTotal  / pageSize);

  return {
    statusCode: 200,
    body: {
      user:      buildSafeUser(user),
      donations: donationsResult,
      received:  receivedResult,
      page,
      pageSize,
      // ✅ [FLOW2-FIX-04] بيانات pagination كاملة — الـ Frontend يعرف الآن كم صفحة متبقية
      donationsTotal,
      receivedTotal,
      hasMoreDonations: page < totalDonationPages,
      hasMoreReceived:  page < totalReceivedPages,
      totalDonationPages,
      totalReceivedPages,
    },
  };
};

// ─── getPublicProfileLogic ────────────────────────────────────────
exports.getPublicProfileLogic = async (targetId, page) => {
  const { pageSize, skip } = await _getProfilePageParams(page);

  const [user, donations, ratingsResult] = await Promise.all([
    userRepository.findPublicProfile(targetId),
    Item.find({ donor: targetId, status: 'delivered' })
      .sort({ deliveredAt: -1 }).skip(skip).limit(pageSize)
      .select('title category images deliveredAt').lean(),
    Rating.find({ rated: targetId })
      .sort({ createdAt: -1 }).skip(skip).limit(pageSize)
      .populate('rater', 'name avatar').lean(),
  ]);

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب غير متاح 🚫' } };

  return {
    statusCode: 200,
    body: {
      user,
      donations,
      ratings: ratingsResult,
      page,
      pageSize,
    },
  };
};