// services/authService.js
const bcrypt         = require('bcryptjs');
const crypto         = require('crypto');
const sendEmail      = require('../utils/sendEmail');
const userRepository = require('../repositories/userRepository');
const Item           = require('../models/Item');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,          // ✅ بدل jwt.verify
} = require('../utils/tokenUtils');
const { generateOtp } = require('../utils/otp'); // ✅ بدل Math.random()


/** يحوّل رقم الهاتف إلى صيغة wa.me الدولية */
const formatPhone = (phone = '') => {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0'))  return '962' + digits.slice(1);
  if (digits.startsWith('7'))  return '962' + digits;
  return digits;
};


// ─── 1. منطق التسجيل ─────────────────────────────────────────
exports.registerLogic = async ({ name, email, password, phone }) => {
  // ✅ selectOtp: true — لأن verificationOtp صار select: false
  let user = await userRepository.findByEmail(email, { selectOtp: true });

  if (user && !user.isVerified) {
    const newOtp = generateOtp();
    user.verificationOtp = newOtp;
    user.name     = name;
    user.password = await bcrypt.hash(password, 10);
    await userRepository.saveUser(user);

    await sendEmail({
      email:   user.email,
      subject: 'تفعيل حسابك في منصة عون ✉️',
      message: `<div style="font-family:sans-serif;text-align:center;direction:rtl;"><h2 style="color:#006155;">أهلاً بك مجدداً في عون يا ${name}! 🎓</h2><p>كود التفعيل الجديد:</p><div style="background:#f3f4f5;padding:20px;border-radius:10px;display:inline-block;margin:20px 0;"><h1 style="color:#087c6e;font-size:40px;margin:0;letter-spacing:10px;">${newOtp}</h1></div></div>`,
    });

    return {
      statusCode: 200,
      body: {
        msg: 'هذا الحساب موجود مسبقاً ولكنه غير مفعل، تم إرسال كود جديد لإيميلك ✉️',
        needsVerification: true,
        email: user.email,
      },
    };
  }

  if (user && user.isVerified) {
    return {
      statusCode: 400,
      body: { msg: 'هذا الحساب موجود مسبقاً ومفعل، يمكنك تسجيل الدخول.' },
    };
  }

  const isVerifiedStudent = email.endsWith('.edu') || email.endsWith('.edu.jo');
  const otp  = generateOtp();
  const salt = await bcrypt.genSalt(10);

  // ✅ trustLevel يُحدَّد تلقائياً عند الإنشاء
  user = await userRepository.createUser({
    name,
    email,
    phone,
    password:          await bcrypt.hash(password, salt),
    isVerifiedStudent,
    trustLevel:        isVerifiedStudent ? 2 : 1, // ✅ طالب جامعي = Level 2 فوراً
    isVerified:        false,
    verificationOtp:   otp,
  });

  await sendEmail({
    email:   user.email,
    subject: 'تفعيل حسابك في منصة عون ✉️',
    message: `<div style="font-family:sans-serif;text-align:center;direction:rtl;"><h2 style="color:#006155;">مرحباً بك في عون يا ${name}! 🎓</h2><p>رمز التحقق:</p><div style="background:#f3f4f5;padding:20px;border-radius:10px;display:inline-block;margin:20px 0;"><h1 style="color:#087c6e;font-size:40px;margin:0;letter-spacing:10px;">${otp}</h1></div></div>`,
  });

  return {
    statusCode: 201,
    body: {
      msg: 'تم إنشاء الحساب بنجاح، يرجى تفقد بريدك الإلكتروني لتفعيل الحساب ✉️',
      user: {
        name:              user.name,
        email:             user.email,
        isVerifiedStudent: user.isVerifiedStudent,
        role:              user.role,
        isVerified:        user.isVerified,
      },
    },
  };
};


// ─── 2. منطق تأكيد الإيميل ───────────────────────────────
exports.verifyEmailLogic = async ({ email, otp }) => {
  // ✅ selectOtp: true — ضروري بعد select: false في الـ Schema
  const user = await userRepository.findByEmail(email, { selectOtp: true });
  
  if (!user)
    return { statusCode: 404, body: { msg: 'المستخدم غير موجود 🛑' } };

  if (user.isVerified)
    return { statusCode: 400, body: { msg: 'هذا الحساب مفعل مسبقاً ✅' } };

  if (user.verificationOtp !== otp)
    return { statusCode: 400, body: { msg: 'رمز التحقق غير صحيح ❌' } };

  user.isVerified      = true;
  user.verificationOtp = undefined;
  await userRepository.saveUser(user);

  return { statusCode: 200, body: { msg: 'تم تفعيل حسابك بنجاح! 🎉' } };
};


// ─── 3. منطق تسجيل الدخول ───────────────────────────────────
exports.loginLogic = async ({ email, password }) => {
  const user = await userRepository.findByEmailWithPassword(email);
  if (!user)
    return { statusCode: 400, body: { msg: 'البريد الإلكتروني غير صحيح' } };
  if (user.isBanned)
    return { statusCode: 403, body: { msg: 'هذا الحساب محظور 🛑' } };

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch)
    return { statusCode: 400, body: { msg: 'كلمة الدخول غير صحيحة' } };

  if (!user.isVerified)
    return {
      statusCode: 403,
      body: { msg: 'حسابك غير مفعل ✉️', needsVerification: true, email: user.email },
    };

  const accessToken  = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  const hashedRefreshToken = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

await userRepository.updateUser(user._id, {
  refreshToken:    hashedRefreshToken,
  sessionIssuedAt: new Date(), // ← تاريخ بداية الجلسة
});
  return {
    statusCode: 200,
    refreshToken,
    body: {
      msg: 'تم تسجيل الدخول بنجاح',
      accessToken,
      user: {
        _id:               user._id,
        name:              user.name,
        email:             user.email,
        phone:             user.phone,
        avatar:            user.avatar,
        role:              user.role,
        trustScore:        user.trustScore,
        trustLevel:        user.trustLevel ?? 1,  // ✅ جديد
        quota:             user.quota,
        isVerified:        user.isVerified,
        isVerifiedStudent: user.isVerifiedStudent,
        isBanned:          user.isBanned,
        totalDonations:    user.totalDonations,
        badges:            user.badges,
        createdAt:         user.createdAt,
        updatedAt:         user.updatedAt,
      },
    },
  };
};


// ─── 4. منطق تجديد الـ Refresh Token Rotation ─────────────
exports.refreshTokenLogic = async (token) => {
  if (!token) {
    return {
      statusCode: 401,
      body: { msg: 'لا يوجد Refresh Token 🛑', code: 'NO_REFRESH_TOKEN' },
    };
  }

  try {
    const decoded     = verifyRefreshToken(token);
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // ✅ اقرأ sessionIssuedAt مع refreshToken في استدعاء واحد
    const userWithSession = await userRepository.findByIdWithSession(decoded.user.id);

    if (!userWithSession || userWithSession.isBanned) {
      return {
        statusCode:  401,
        clearCookie: true,
        body: { msg: 'الجلسة غير صالحة 🛑', code: 'INVALID_SESSION' },
      };
    }

    // ✅ Absolute Session Lifetime — 30 يوم من أول تسجيل دخول
    // حتى لو المهاجم يواصل التجديد، الجلسة تنتهي بعد 30 يوم إجبارياً
    const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const sessionAge = Date.now() - new Date(userWithSession.sessionIssuedAt).getTime();

    if (sessionAge > SESSION_MAX_AGE_MS) {
      // امسح الجلسة من DB — يُجبر المستخدم على login جديد
      await userRepository.updateUser(userWithSession._id, {
        $unset: { refreshToken: 1, sessionIssuedAt: 1 },
      });
      return {
        statusCode:  401,
        clearCookie: true,
        body: {
          msg:  'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً ⏰',
          code: 'SESSION_EXPIRED',
        },
      };
    }

    // ✅ جهّز التوكنات الجديدة قبل العملية الذرية
    const newAccessToken  = generateAccessToken({ id: decoded.user.id });
    const newRefreshToken = generateRefreshToken({ id: decoded.user.id });
    const newHashedToken  = crypto
      .createHash('sha256')
      .update(newRefreshToken)
      .digest('hex');

    // ✅ Atomic Rotation — تحقق من الهاش القديم + تحديث بالجديد في عملية واحدة
    // إذا رجعت null = token قديم أو مسروق = reuse detection تلقائي
    const updatedUser = await userRepository.rotateRefreshToken(
      decoded.user.id,
      hashedToken,   // ← يجب أن يطابق ما في DB
      newHashedToken // ← يحل محله
    );

    if (!updatedUser) {
      return {
        statusCode:  401,
        clearCookie: true,
        body: {
          msg:  'Refresh Token غير صالح أو مُعاد استخدامه 🛑',
          code: 'TOKEN_REUSE_DETECTED',
        },
      };
    }

    return {
      statusCode:   200,
      refreshToken: newRefreshToken,
      body: {
        msg:         'تم تجديد الجلسة بنجاح',
        accessToken: newAccessToken,
      },
    };

  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return {
      statusCode:  401,
      clearCookie: true,
      body: {
        msg:  isExpired ? 'انتهت صلاحية الجلسة ⏰' : 'جلسة غير صالحة ⚠️',
        code: isExpired ? 'REFRESH_EXPIRED'        : 'INVALID_REFRESH',
      },
    };
  }
};


// ─── 5. تسجيل الخروج ───────────────────────────────────────
exports.logoutLogic = async (userId) => {
  // ✅ امسح refreshToken و sessionIssuedAt معاً عند الخروج
  await userRepository.updateUser(userId, {
    $unset: { refreshToken: 1, sessionIssuedAt: 1 },
  });

  return {
    statusCode: 200,
    body: { msg: 'تم تسجيل الخروج بنجاح 👋' },
  };
};

// ─── 6. بروفايل خاص (GET /me) ──────────────────────────────
exports.getUserProfileLogic = async (userId) => {
  const [user, allDonations, completedRequests, totalRatings] = await Promise.all([
    userRepository.findById(userId),
    Item.find({ donor: userId })
      .populate('bookedBy', 'name avatar')
      .sort({ createdAt: -1 }),
    Item.find({ bookedBy: userId, status: 'تم التسليم' })
      .populate('donor', 'name avatar')
      .sort({ createdAt: -1 }),
    Item.countDocuments({ donor: userId, isRated: true }),
  ]);

  if (!user) {
    return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  }

  return {
    statusCode: 200,
    body: {
      user,
      stats: {
        donationsCount:     allDonations.length,
        completedDonations: allDonations.filter((i) => i.status === 'تم التسليم').length,
        receivedCount:      completedRequests.length,
        totalRatings,
      },
      allDonations,
      completedRequests,
    },
  };
};


// ─── 7. بروفايل عام (GET /profile/:id) ─────────────────────
exports.getPublicProfileLogic = async (userId) => {
  const [user, allDonations, completedRequests, totalRatings] = await Promise.all([
    userRepository.findById(userId),
    Item.find({ donor: userId, status: { $ne: 'مخفي' } })
      .select('title imageUrl status createdAt')
      .sort({ createdAt: -1 }),
    Item.find({ bookedBy: userId, status: 'تم التسليم' })
      .select('title imageUrl status createdAt')
      .sort({ createdAt: -1 }),
    Item.countDocuments({ donor: userId, isRated: true }),
  ]);

  if (!user)       return { statusCode: 404, body: { msg: 'المستخدم غير موجود' } };
  if (user.isBanned) return { statusCode: 403, body: { msg: 'هذا الحساب محظور' } };

  return {
    statusCode: 200,
    body: {
      user: {
        name:              user.name,
        avatar:            user.avatar,
        trustScore:        user.trustScore,
        trustLevel:        user.trustLevel ?? 1,  // ✅ جديد
        totalDonations:    user.totalDonations,
        isVerifiedStudent: user.isVerifiedStudent,
        createdAt:         user.createdAt,
        whatsapp:          formatPhone(user.phone),
      },
      stats: {
        donationsCount: allDonations.length,
        receivedCount:  completedRequests.length,
        totalRatings,
      },
      allDonations,
      completedRequests,
    },
  };
};


// ─── 8. نسيت كلمة المرور ────────────────────────────────────
exports.forgotPasswordLogic = async (email) => {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    return {
      statusCode: 404,
      body: { msg: 'لا يوجد حساب مسجل بهذا الإيميل' },
    };
  }

  const resetToken = crypto.randomBytes(20).toString('hex');
  user.resetPasswordToken  = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
  await userRepository.saveUser(user);

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetUrl  = `${clientUrl}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      email:   user.email,
      subject: 'استعادة كلمة المرور - منصة عون 🔒',
      message: `<div dir="rtl"><h2>طلب استعادة كلمة المرور</h2><a href="${resetUrl}" style="background:#006155;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-top:10px;">إعادة تعيين كلمة المرور</a></div>`,
    });

    return {
      statusCode: 200,
      body: { msg: 'تم إرسال رابط الاستعادة إلى بريدك الإلكتروني' },
    };
  } catch {
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpire = undefined;
    await userRepository.saveUser(user);

    return {
      statusCode: 500,
      body: { msg: 'حدث خطأ أثناء إرسال البريد الإلكتروني' },
    };
  }
};


// ─── 9. إعادة تعيين كلمة المرور ────────────────────────────
exports.resetPasswordLogic = async (token, newPassword) => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await userRepository.findByResetToken(hashedToken);

  if (!user) {
    return {
      statusCode: 400,
      body: { msg: 'الرابط غير صالح أو انتهت صلاحيته ❌' },
    };
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    return {
      statusCode: 400,
      body: { msg: 'يرجى اختيار كلمة مرور جديدة تختلف عن الحالية ❌' },
    };
  }

  const salt = await bcrypt.genSalt(10);
  user.password            = await bcrypt.hash(newPassword, salt);
  user.resetPasswordToken  = undefined;
  user.resetPasswordExpire = undefined;
  await userRepository.saveUser(user);

  return {
    statusCode: 200,
    body: { msg: 'تم تغيير كلمة المرور بنجاح! ✅' },
  };
};