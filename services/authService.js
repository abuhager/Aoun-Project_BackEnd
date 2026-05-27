// services/authService.js


const bcrypt         = require('bcryptjs');
const crypto         = require('crypto');
const User           = require('../models/User');
const Item           = require('../models/Item');
const { generateOtp }              = require('../utils/otp');
const { sendEmail, fireSendEmail } = require('../utils/sendEmail');
const userRepository               = require('../repositories/userRepository');
const Rating = require('../models/Rating');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  REFRESH_COOKIE_OPTIONS,
} = require('../utils/tokenUtils');

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// ✅ helper — اكتشاف الإيميل الجامعي
const JORDANIAN_UNIVERSITY_DOMAINS = [
  // الجامعة الأردنية
  '@student.ju.edu.jo', '@ju.edu.jo',
  // الزيتونة
  '@std-zuj.edu.jo', '@zuj.edu.jo',
  // اليرموك
  '@stu.yarmouk.edu.jo', '@yarmouk.edu.jo',
  // مؤتة
  '@students.mut.edu.jo', '@mut.edu.jo',
  // الهاشمية
  '@stu.hu.edu.jo', '@hu.edu.jo',
  // البلقاء التطبيقية
  '@student.bau.edu.jo', '@bau.edu.jo',
  // العربية الأمريكية
  '@students.aaup.edu', '@aaup.edu',
  // العلوم والتكنولوجيا (JUST)
  '@stu.just.edu.jo', '@just.edu.jo',
  // فيلادلفيا
  '@student.philadelphia.edu.jo', '@philadelphia.edu.jo',
  // الشرق الأوسط (MEU)
  '@student.meu.edu.jo', '@meu.edu.jo',
  // البترا
  '@students.pu.edu.jo', '@pu.edu.jo',
  // الإسراء
  '@stu.isra.edu.jo', '@isra.edu.jo',
  // عمان الأهلية
  '@students.ammanu.edu.jo', '@ammanu.edu.jo',
  // الألمانية الأردنية (GJU)
  '@student.gju.edu.jo', '@gju.edu.jo',
  // عمان العربية
  '@students.aau.edu.jo', '@aau.edu.jo',
  // الأميرة سمية (PSUT)
  '@psut.edu.jo',
  // الإدارة والتكنولوجيا (AMU)
  '@amu.edu.jo',
];

const isUniversityEmail = (email) =>
  JORDANIAN_UNIVERSITY_DOMAINS.some((domain) => email.endsWith(domain));


// ─── 1. التسجيل ──────────────────────────────────────────────
exports.registerLogic = async ({ name, email, password, phone }) => {
  const exists = await userRepository.findByEmail(email);
  if (exists) {
    return { statusCode: 400, body: { msg: 'هذا الإيميل مسجل مسبقاً' } };
  }

  const salt   = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);
  const newOtp = generateOtp();

  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  // ✅ إيميل جامعي → trustLevel 2 تلقائياً
  const isStudent = isUniversityEmail(email);

  const user = await userRepository.createUser({
    name,
    email,
    password:              hashed,
    phone:                 phone || undefined,
    verificationOtp:       newOtp,
    verificationOtpExpiry: otpExpiry,
    isVerifiedStudent:     isStudent,
    trustLevel:            isStudent ? 2 : 1, // ✅
  });

  fireSendEmail({
    email,
    subject: 'تحقق من إيميلك - منصة عون 📬',
    message: `<div dir="rtl">
      <h2>مرحباً ${name}!</h2>
      <p>رمز التحقق الخاص بك:</p>
      <h1 style="letter-spacing:8px;color:#006155;">${newOtp}</h1>
      <p style="color:#888;">ينتهي خلال 10 دقائق</p>
      ${isStudent ? '<p style="color:#006155;">✅ تم التحقق من انتمائك الجامعي تلقائياً</p>' : ''}
    </div>`,
  });

  return {
    statusCode: 201,
    body: {
      msg:              'تم إنشاء الحساب! تحقق من إيميلك 📬',
      email,
      isVerifiedStudent: isStudent,
    },
  };
};


// ─── 2. تحقق الإيميل (OTP) ───────────────────────────────────
exports.verifyEmailLogic = async ({ email, otp }) => {
  const user = await userRepository.findByEmail(email, { selectOtp: true });

  if (!user) {
    return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  }
  if (user.isVerified) {
    return { statusCode: 400, body: { msg: 'الإيميل محقق مسبقاً ✅' } };
  }
  if (!user.verificationOtpExpiry || Date.now() > user.verificationOtpExpiry.getTime()) {
    return {
      statusCode: 400,
      body: { msg: 'انتهت صلاحية رمز التحقق ⏰ — اطلب رمزاً جديداً' },
    };
  }
  if (user.verificationOtp !== otp) {
    return { statusCode: 400, body: { msg: 'رمز التحقق غير صحيح ❌' } };
  }

  // ✅ تفعيل الحساب
  user.isVerified            = true;
  user.verificationOtp       = undefined;
  user.verificationOtpExpiry = undefined;

  // ✅ إيميل جامعي → trustLevel 2 عند التحقق
  if (isUniversityEmail(user.email)) {
    user.isVerifiedStudent = true;
    if (!user.trustLevel || user.trustLevel < 2) user.trustLevel = 2;
  }

  await userRepository.saveUser(user);

  const accessToken   = generateAccessToken(user);
  const refreshToken  = generateRefreshToken(user);
  const hashedRefresh = hashToken(refreshToken);

  await userRepository.updateUser(user._id, {
    refreshToken:    hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg:        'تم التحقق من إيميلك بنجاح ✅',
      accessToken,
      user: {
        _id:               user._id,
        name:              user.name,
        email:             user.email,
        avatar:            user.avatar,
        role:              user.role,
        trustScore:        user.trustScore,
        trustLevel:        user.trustLevel ?? 1,
        quota:             user.quota,
        isVerified:        true,
        isVerifiedStudent: user.isVerifiedStudent,
      },
    },
  };
};


exports.loginLogic = async ({ email, password }) => {
  const user = await userRepository.findByEmailWithPassword(email);

  // ─── 1. تحقق من وجود المستخدم ───────────────────────────
  if (!user) {
    return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };
  }

  // ─── 2. تحقق من الحظر ────────────────────────────────────
  if (user.isBanned) {
    return { statusCode: 403, body: { msg: 'هذا الحساب محظور 🚫' } };
  }

  // ─── 3. تحقق من كلمة السر أولاً (قبل أي OTP) ────────────
  // ✅ مهم: نتحقق من الباسورد قبل إرسال OTP
  // لمنع أي شخص من إرسال OTP لحساب شخص آخر بمعرفة إيميله فقط
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return { statusCode: 401, body: { msg: 'بيانات الدخول غير صحيحة' } };
  }

  // ─── 4. الحساب غير مفعّل → أعد إرسال OTP ────────────────
  if (!user.isVerified) {
    const newOtp    = generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // حدّث OTP في قاعدة البيانات
    await userRepository.updateUser(user._id, {
      verificationOtp:       newOtp,
      verificationOtpExpiry: otpExpiry,
    });

    // أرسل إيميل التحقق
    fireSendEmail({
      email,
      subject: 'تحقق من إيميلك - منصة عون 📬',
      message: `<div dir="rtl">
        <h2>مرحباً ${user.name}!</h2>
        <p>طلبت تسجيل الدخول، لكن حسابك لم يُفعَّل بعد.</p>
        <p>رمز التحقق الجديد الخاص بك:</p>
        <h1 style="letter-spacing:8px;color:#006155;">${newOtp}</h1>
        <p style="color:#888;">ينتهي خلال 10 دقائق</p>
      </div>`,
    });

    return {
      statusCode: 403,
      body: {
        msg:   'حسابك غير مفعّل — تم إرسال رمز تحقق جديد إلى إيميلك 📧',
        code:  'NOT_VERIFIED', // ← الـ Frontend يقرأ هذا ويوجّه لصفحة التفعيل
        email: user.email,
      },
    };
  }

  // ─── 5. تحديث trustLevel لإيميل جامعي إن لزم ────────────
  if (isUniversityEmail(email) && (!user.trustLevel || user.trustLevel < 2)) {
    await userRepository.updateUser(user._id, {
      isVerifiedStudent: true,
      trustLevel:        2,
    });
    user.isVerifiedStudent = true;
    user.trustLevel        = 2;
  }

  // ─── 6. إنشاء التوكنز ────────────────────────────────────
  const accessToken  = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  const hashedRefresh = hashToken(refreshToken);
  await userRepository.updateUser(user._id, {
    refreshToken:    hashedRefresh,
    sessionIssuedAt: new Date(),
  });

  // ─── 7. رجّع البيانات ─────────────────────────────────────
  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg:        'مرحباً بعودتك 👋',
      accessToken,
      user: {
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
      },
    },
  };
};
// ─── 4. تجديد الجلسة (Refresh Token Rotation) ────────────────
exports.refreshLogic = async (refreshToken) => {
  if (!refreshToken) {
    return {
      statusCode:  401,
      clearCookie: true,
      body: { msg: 'لا يوجد Refresh Token', code: 'NO_REFRESH' },
    };
  }

  try {
    const decoded        = verifyRefreshToken(refreshToken);
    const hashedIncoming = hashToken(refreshToken);

    const user = await userRepository.findByIdWithSession(decoded.user.id);

    if (!user || user.refreshToken !== hashedIncoming) {
      return {
        statusCode:  401,
        clearCookie: true,
        body: { msg: 'الجلسة غير صالحة أو انتُهكت 🚨', code: 'REFRESH_REUSE' },
      };
    }
    if (user.isBanned) {
      return {
        statusCode:  403,
        clearCookie: true,
        body: { msg: 'حسابك محظور 🚫', code: 'BANNED' },
      };
    }

    const newAccessToken  = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const newHash         = hashToken(newRefreshToken);

    const rotated = await User.findOneAndUpdate(
      { _id: user._id, refreshToken: hashedIncoming },
      { $set: { refreshToken: newHash, sessionIssuedAt: new Date() } },
      { new: true }
    );

    if (!rotated) {
      return {
        statusCode:  401,
        clearCookie: true,
        body: { msg: 'الجلسة غير صالحة أو انتُهكت 🚨', code: 'REFRESH_REUSE' },
      };
    }

    return {
      statusCode:      200,
      newRefreshToken,
      body: { accessToken: newAccessToken },
    };

  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return {
      statusCode:  401,
      clearCookie: true,
      body: {
        msg:  isExpired ? 'انتهت صلاحية الجلسة ⏰' : 'جلسة غير صالحة ⚠️',
        code: isExpired ? 'REFRESH_EXPIRED'         : 'INVALID_REFRESH',
      },
    };
  }
};


// ─── 5. تسجيل الخروج ─────────────────────────────────────────
exports.logoutLogic = async (userId) => {
  await userRepository.updateUser(userId, {
    $unset: { refreshToken: 1, sessionIssuedAt: 1 },
  });
  return { statusCode: 200, body: { msg: 'تم تسجيل الخروج بنجاح 👋' } };
};


// ─── 6. بروفايل خاص (GET /me) ────────────────────────────────
exports.getUserProfileLogic = async (userId, page = 1) => {
  const LIMIT = 10;
  const skip  = (page - 1) * LIMIT;

  const [user, donations, received, totalRatings, totalDonationsCount, totalReceivedCount] =
    await Promise.all([
      userRepository.findById(userId),

      Item.find({ donor: userId })
        .populate('bookedBy', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip).limit(LIMIT)
        .lean(),

      Item.find({ bookedBy: userId, status: 'تم التسليم' })
        .populate('donor', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip).limit(LIMIT)
        .lean(),

      Rating.countDocuments({ ratee: userId }),

      // ✅ العدد الكلي الحقيقي من DB — لحساب hasMore و stats
      Item.countDocuments({ donor: userId }),
      Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    ]);

  if (!user) return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };

  const safeUser = {
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
    totalDonations:    user.totalDonations,
    badges:            user.badges,
    createdAt:         user.createdAt,
  };

  return {
    statusCode: 200,
    body: {
      user: safeUser,
      stats: {
        // ✅ العدد الحقيقي الكلي — لا عدد الصفحة الحالية فقط
        donationsCount:     totalDonationsCount,
        completedDonations: donations.filter(i => i.status === 'تم التسليم').length,
        receivedCount:      totalReceivedCount,
        totalRatings,
      },
      allDonations:      donations,
      completedRequests: received,
      page,
      totalPages: Math.max(
        Math.ceil(totalDonationsCount / LIMIT),
        Math.ceil(totalReceivedCount  / LIMIT),
      ),
      // ✅ hasMore دقيق — بناءً على العدد الكلي الحقيقي
      hasMore: page * LIMIT < totalDonationsCount || page * LIMIT < totalReceivedCount,
    },
  };
};


// ─── 7. بروفايل عام (GET /profile/:id) ───────────────────────
exports.getPublicProfileLogic = async (userId, page = 1) => {
  const LIMIT = 10;
  const skip  = (page - 1) * LIMIT;

  const [user, donations, received, totalRatings, totalDonationsCount, totalReceivedCount] =
    await Promise.all([
      userRepository.findById(userId),

      Item.find({ donor: userId, status: { $ne: 'مخفي' } })
        .select('title imageUrl status createdAt')
        .sort({ createdAt: -1 })
        .skip(skip).limit(LIMIT)
        .lean(),

      Item.find({ bookedBy: userId, status: 'تم التسليم' })
        .select('title imageUrl status createdAt')
        .sort({ createdAt: -1 })
        .skip(skip).limit(LIMIT)
        .lean(),

      Rating.countDocuments({ ratee: userId }),

      // ✅ العدد الكلي الحقيقي من DB
      Item.countDocuments({ donor: userId, status: { $ne: 'مخفي' } }),
      Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' }),
    ]);

  if (!user)         return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور' } };

  return {
    statusCode: 200,
    body: {
      user: {
        name:              user.name,
        avatar:            user.avatar,
        trustScore:        user.trustScore,
        trustLevel:        user.trustLevel ?? 1,
        totalDonations:    user.totalDonations,
        isVerifiedStudent: user.isVerifiedStudent,
        createdAt:         user.createdAt,
      },
      stats: {
        // ✅ العدد الحقيقي الكلي
        donationsCount: totalDonationsCount,
        receivedCount:  totalReceivedCount,
        totalRatings,
      },
      allDonations:      donations,
      completedRequests: received,
      page,
      totalPages: Math.max(
        Math.ceil(totalDonationsCount / LIMIT),
        Math.ceil(totalReceivedCount  / LIMIT),
      ),
      // ✅ hasMore دقيق
      hasMore: page * LIMIT < totalDonationsCount || page * LIMIT < totalReceivedCount,
    },
  };
};


// ─── 8. نسيت كلمة المرور ─────────────────────────────────────
exports.forgotPasswordLogic = async (email) => {
  const user = await userRepository.findByEmail(email);

  if (!user) {
    return {
      statusCode: 200,
      body: { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' },
    };
  }

  const resetToken = crypto.randomBytes(20).toString('hex');
  user.resetPasswordToken  = hashToken(resetToken);
  user.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
  await userRepository.saveUser(user);

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl  = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      email:   user.email,
      subject: 'استعادة كلمة المرور - منصة عون 🔒',
      message: `<div dir="rtl">
        <h2>طلب استعادة كلمة المرور</h2>
        <a href="${resetUrl}" style="background:#006155;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:10px;">
          إعادة تعيين كلمة المرور
        </a>
        <p style="color:#888;margin-top:10px;">ينتهي الرابط خلال 15 دقيقة</p>
      </div>`,
    });

    return {
      statusCode: 200,
      body: { msg: 'إذا كان هذا الإيميل مسجلاً، ستصلك رسالة استعادة قريباً 📧' },
    };
  } catch {
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpire = undefined;
    await userRepository.saveUser(user);
    return { statusCode: 500, body: { msg: 'حدث خطأ أثناء إرسال البريد الإلكتروني' } };
  }
};


// ─── 9. إعادة تعيين كلمة المرور ──────────────────────────────
exports.resetPasswordLogic = async (token, newPassword) => {
  const hashedToken = hashToken(token);
  const user        = await userRepository.findByResetToken(hashedToken);

  if (!user) {
    return { statusCode: 400, body: { msg: 'الرابط غير صالح أو انتهت صلاحيته ❌' } };
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    return { statusCode: 400, body: { msg: 'يرجى اختيار كلمة مرور جديدة تختلف عن الحالية ❌' } };
  }

  const salt = await bcrypt.genSalt(10);
  user.password            = await bcrypt.hash(newPassword, salt);
  user.resetPasswordToken  = undefined;
  user.resetPasswordExpire = undefined;
  await userRepository.saveUser(user);

  return { statusCode: 200, body: { msg: 'تم تغيير كلمة المرور بنجاح! ✅' } };
};