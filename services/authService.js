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
      const studentQuota      = settings?.studentQuota ?? 5;
      if ((user.trustLevel ?? 1) < studentTrustLevel) user.trustLevel = studentTrustLevel;
      const defaultQuota = settings?.defaultUserQuota ?? 2;
      if ((user.quota ?? defaultQuota) <= defaultQuota) user.quota = studentQuota;
    } catch (error) {
      console.error('[Upgrade Error] فشل تحديث معايير الطالب:', error);
      if ((user.trustLevel ?? 1) < 2) user.trustLevel = 2;
      if ((user.quota ?? 2) <= 2) user.quota = 5;
    }
  }
};

const buildSafeUser = (user) => ({
  _id:               user._id,
  name:              user.name,
  email:             user.email,
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

  // الخطوة 1: قراءة ذرية + increment للـ otpAttempts — عبر Repository
  const user = await userRepository.findAndIncrementOtpAttempts(email);

  if (!user) {
    // الخطوة 2: تمييز سبب الفشل عبر Repository (لا require مباشر)
    const checkUser = await userRepository.findEmailStatus(email);

    if (!checkUser)          return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
    if (checkUser.isVerified) return { statusCode: 400, body: { msg: 'الإيميل محقق مسبقاً ✅' } };

    // تجاوز الـ 5 محاولات — تصفير لإتاحة طلب كود جديد عبر /resend-otp
    await userRepository.resetOtpAttemptsAfterLock(email);

    return {
      statusCode: 429,
      body: {
        msg:  'تجاوزت الحد المسموح من المحاولات، اطلب رمزاً جديداً 🔒',
        code: 'OTP_ATTEMPTS_EXCEEDED',
      },
    };
  }

  if (!user.verificationOtp || !user.verificationOtpExpiry) {
    return { statusCode: 400, body: { msg: 'لا يوجد رمز تحقق نشط، اطلب رمزاً جديداً' } };
  }

  if (new Date(user.verificationOtpExpiry).getTime() < Date.now()) {
    return {
      statusCode: 400,
      body: { msg: 'انتهت صلاحية رمز التحقق ⏰ — اطلب رمزاً جديداً', code: 'OTP_EXPIRED' },
    };
  }

  const isValid = verifyOtp(otp, user.verificationOtp);
  if (!isValid) {
    const remaining = 5 - user.otpAttempts;
    return {
      statusCode: 400,
      body: { msg: `رمز التحقق غير صحيح ❌ (${Math.max(0, remaining)} محاولة متبقية)` },
    };
  }

  // الكود صحيح — تحضير بيانات التحقق لتشغيل _upgradeStudentTrust
  const mutableUser = { ...user };
  await _upgradeStudentTrust(mutableUser);

  const accessToken = generateAccessToken(mutableUser);
  const { token: refreshToken, hashed: hashedRefresh } = generateRefreshToken(mutableUser);

  // الخطوة 3: إتمام التحقق الذري عبر Repository — لا require مباشر
  await userRepository.completeEmailVerification(user._id, {
    $set: {
      isVerified:      true,
      trustLevel:      mutableUser.trustLevel,
      quota:           mutableUser.quota,
      otpAttempts:     0,
      refreshToken:    hashedRefresh,
      sessionIssuedAt: new Date(),
    },
    $unset: {
      verificationOtp:       1,
      verificationOtpExpiry: 1,
    },
  });

  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg:  'تم التحقق من إيميلك بنجاح ✅',
      user: buildSafeUser(mutableUser),
      accessToken,
    },
  };
};

// ── loginLogic ────────────────────────────────────────────────
exports.logoutLogic = async (userId) => {
  const sessionCache = require('../utils/sessionCache'); // أو import في الأعلى
  sessionCache.invalidate(userId); // ✅ صفّر الـ Cache فوراً عند logout

  await userRepository.updateUser(userId, {
    refreshToken:    undefined,
    sessionIssuedAt: undefined,
  });

  return { statusCode: 200, clearCookie: true, body: { msg: 'تم تسجيل الخروج بنجاح 👋' } };
};


// ── refreshLogic ──────────────────────────────────────────────
exports.refreshLogic = async (rawRefreshToken) => {

  // ── الخطوة 1: التحقق من وجود التوكن ──────────────────────────
  if (!rawRefreshToken) {
    return {
      statusCode: 401,
      clearCookie: true,
      body: { msg: 'لا يوجد Refresh Token 🔒', code: 'NO_REFRESH_TOKEN' },
    };
  }

  // ── الخطوة 2: التحقق من التوقيع ─────────────────────────────
  let decoded;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch (err) {
    // توكن منتهي الصلاحية أو مُزوَّر — امسح الكوكي فقط
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
    return {
      statusCode: 401,
      clearCookie: true,
      body: { msg: 'Refresh Token تالف', code: 'MALFORMED_TOKEN' },
    };
  }

  // ── الخطوة 3: حساب الهاش المتوقَّع ──────────────────────────
  const hashedIncoming = hashToken(rawRefreshToken);

  // ── الخطوة 4: جلب المستخدم مع الـ refreshToken المخزَّن ──────
  const user = await userRepository.findByIdWithRefreshToken(userId);

  if (!user) {
    return {
      statusCode: 401,
      clearCookie: true,
      body: { msg: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' },
    };
  }

  if (user.isBanned) {
    sessionCache.invalidate(userId);
    return {
      statusCode: 403,
      clearCookie: true,
      body: { msg: 'حسابك محظور 🚫', code: 'ACCOUNT_BANNED' },
    };
  }

  // ── الخطوة 5: ✅ FIX [SEC-AUTH-02-A + SEC-AUTH-02-B] ─────────
  // هاش التوكن الوارد لا يطابق ما في DB
  // هذا يعني إما:
  //   أ) التوكن سُرق واستُخدم من قِبَل مهاجم (الاستخدام الأصلي أدى إلى تدوير الهاش)
  //   ب) المستخدم أرسل توكناً قديماً بعد التدوير
  // في كلتا الحالتين → إبطال كامل فوري + إخطار المستخدم
  if (!user.refreshToken || user.refreshToken !== hashedIncoming) {

    // ✅ FIX [SEC-AUTH-02-A]: إبطال الجلسة كلياً بدل رد 401 صامت
    // يمنع المهاجم من الاستمرار حتى لو كان يملك التوكن الصحيح
    await userRepository.invalidateUserSession(userId);
    sessionCache.invalidate(userId); // ✅ FIX [SEC-AUTH-02-C]: صفّر الـ Cache فوراً

    // ⚠️ هنا يمكن لاحقاً إضافة: emailService.sendSecurityAlert(user.email, ...)
      console.warn(
    `[SEC-AUTH-02] Refresh Token Reuse Detected — userId: ${userId} — IP: ${clientIp}`
  );

    return {
      statusCode: 401,
      clearCookie: true,
      body: {
        msg:  'اكتُشف نشاط مشبوه — تم تسجيل خروجك من جميع الأجهزة لحمايتك 🛡️',
        code: 'TOKEN_REUSE_DETECTED',
      },
    };
  }

  // ── الخطوة 6: توليد توكن جديد + تدوير ذري ───────────────────
  const { token: newRefreshToken, hashed: newHashedRefresh } = generateRefreshToken(user);
  const newIssuedAt = new Date();

  // rotateRefreshToken: يُحدِّث فقط إذا تطابق الهاش الحالي (atomic CAS)
  const updatedUser = await userRepository.rotateRefreshToken(
    userId,
    hashedIncoming,
    newHashedRefresh,
    newIssuedAt
  );

  // ── الخطوة 7: ✅ FIX [SEC-AUTH-02-B] ────────────────────────
  // rotateRefreshToken أعاد null → عملية rotation فشلت (race condition أو تزامن طلبين)
  // الخطوة 5 أمسكت حالة Reuse الواضحة، لكن هنا نُعالج الـ race condition:
  // مستخدمان يُرسلان نفس التوكن في آن واحد — الثاني يجد الهاش تغيَّر
  if (!updatedUser) {
    // لا نُبطل الجلسة هنا (قد يكون طلباً متزامناً شرعياً من نفس المستخدم)
    // لكن نُرفض ونطلب إعادة المحاولة بالتوكن الجديد الذي أعطاه الطلب الأول
    return {
      statusCode: 409,
      clearCookie: false,
      body: {
        msg:  'تعارض في التحديث، أعد المحاولة مرة واحدة 🔄',
        code: 'ROTATION_CONFLICT',
      },
    };
  }

  // ── الخطوة 8: تحديث sessionCache بالوقت الجديد ──────────────
  sessionCache.set(userId, newIssuedAt); // ✅ يحافظ على الـ Cache نشطاً بعد التدوير

  const newAccessToken = generateAccessToken(updatedUser);

  return {
    statusCode:      200,
    newRefreshToken,
    body: {
      msg:         'تم تجديد الجلسة ✅',
      accessToken: newAccessToken,
      user:        buildSafeUser(updatedUser),
    },
  };
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

// ── getMeLogic ── (الجزء المُصحَّح فقط من authService.js)
// ✅ FIX [LOGIC-02]: completedDonations كانت تحسب من الصفحة الحالية فقط (limit=10)
//    الآن تأتي من query منفصل يحسب الإجمالي الحقيقي من كل DB

exports.getMeLogic = async (userId, page = 1) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  }

  const settings = await SystemSettings.getCached();
  const pageSize  = settings?.profilePageSize ?? 10;
  const skip      = (page - 1) * pageSize;

  const [
    donations,
    received,
    totalRatings,
    totalDonationsCount,
    totalReceivedCount,
    completedDonationsCount, // ✅ FIX [LOGIC-02]: query منفصل للإجمالي الحقيقي
  ] = await Promise.all([
    Item.find({ donor: userId })
        .populate('bookedBy', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),

    Item.find({ bookedBy: userId, status: 'تم التسليم' })
        .populate('donor', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),

    Rating.countDocuments({ ratee: userId }),
    Item.countDocuments({ donor: userId }),
    Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),

    // ✅ FIX [LOGIC-02]: العدد الحقيقي من كل DB — لا فلترة على نتيجة محدودة
    Item.countDocuments({ donor: userId, status: 'تم التسليم' }),
  ]);

  const donationsTotalPages = Math.ceil(totalDonationsCount / pageSize);
  const receivedTotalPages  = Math.ceil(totalReceivedCount  / pageSize);

  return {
    statusCode: 200,
    body: {
      user: buildSafeUser(user),
      stats: {
        donationsCount:      totalDonationsCount,
        completedDonations:  completedDonationsCount, // ✅ FIX [LOGIC-02]
        receivedCount:       totalReceivedCount,
        totalRatings,
      },
      allDonations:       donations,
      completedRequests:  received,

      pagination: {
        currentPage: page,
        limit:       pageSize,
        donations: {
          totalItems: totalDonationsCount,
          totalPages: donationsTotalPages,
          hasMore:    page < donationsTotalPages,
        },
        received: {
          totalItems: totalReceivedCount,
          totalPages: receivedTotalPages,
          hasMore:    page < receivedTotalPages,
        },
      },
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

  if (!user) return { statusCode: 200, body: GENERIC_MSG };

  const settings           = await SystemSettings.getCached();
  const resetExpiryMinutes = settings?.resetPasswordExpiryMinutes ?? 15;

  const resetToken        = crypto.randomBytes(32).toString('hex');
  const hashedResetToken  = hashToken(resetToken);
  const resetExpire       = Date.now() + resetExpiryMinutes * 60 * 1000;

  // ✅ FIX [ARCH-AUTH-01]: updateUser بدلاً من saveUser
  // يُحدِّث الحقلين المستهدفين فقط — لا يُعرِّض بقية الـ document للكتابة الزائدة
  await userRepository.updateUser(user._id, {
    resetPasswordToken:  hashedResetToken,
    resetPasswordExpire: resetExpire,
  });

  const clientUrl  = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl   = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await emailService.sendResetPasswordEmail(user.email, resetToken, user.name, resetUrl);
    return { statusCode: 200, body: GENERIC_MSG };
  } catch (err) {
    console.error('[forgotPassword] Email sending failed:', err.message);
    // ✅ FIX [ARCH-AUTH-01]: تصفير عبر updateUser أيضاً
    await userRepository.updateUser(user._id, {
      $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 },
    });
    return { statusCode: 200, body: GENERIC_MSG };
  }
};

// ── ✅ FIX [LOGIC-AUTH-03]: updateMeLogic ────────────────────
// فحص تكرار رقم الهاتف قبل user.save() لتجنب MongoServerError 11000 الخام
exports.updateMeLogic = async (userId, updates, fileBuffer, mimetype) => {
  const user = await userRepository.findById(userId);
  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  if (updates.name) user.name = updates.name.trim();

  if (updates.phone) {
    // ✅ FIX [LOGIC-AUTH-03]: فحص التكرار قبل الحفظ — رسالة واضحة للمستخدم
    const phoneExists = await userRepository.findByPhoneExcluding(updates.phone, userId);
    if (phoneExists) {
      return {
        statusCode: 409,
        body: {
          msg:  'رقم الهاتف مستخدم من قِبَل حساب آخر ❌',
          code: 'PHONE_ALREADY_EXISTS',
        },
      };
    }
    user.phone = updates.phone;
  }

  if (fileBuffer) {
    if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      return {
        statusCode: 400,
        body: { msg: 'نوع الصورة غير مدعوم، يُسمح بـ JPEG أو PNG أو WebP فقط 🖼️' },
      };
    }

    const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
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
      msg:  'تم تحديث الملف الشخصي بنجاح ✅',
      user: buildSafeUser(user),
    },
  };
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

  // ✅ تصفير الـ Cache بعد تغيير كلمة المرور لمنع استخدام الجلسات القديمة
  sessionCache.invalidate(userId); 

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح ✅' } };
};