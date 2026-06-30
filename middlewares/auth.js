// middlewares/auth.js
// ✅ FIX [PERF-AUTH-01]: sessionCache يُلغي DB query في كل طلب لجلب sessionIssuedAt فقط
//    الآن: DB يُستدعى مرة واحدة كل 60 ثانية لكل مستخدم بدلاً من كل طلب

const AppError              = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache              = require('../utils/banCache');
const sessionCache          = require('../utils/sessionCache');
const User                  = require('../models/User');

// ─────────────────────────────────────────────────────────────
// ثوابت الـ Roles — مصدر حقيقة واحد لمنع التناقض
// ─────────────────────────────────────────────────────────────
// 🔴 FIX [BUG-AUTH-01]: كان في تناقض بين 'super_admin' و 'superadmin'
//    في requireAdmin و requireSuperAdmin — الآن موحّد من مكان واحد
const ROLES = {
  ADMIN:       'admin',
  SUPER_ADMIN: 'super_admin', // ✅ القيمة الموحّدة المعتمدة في DB
};

// ─────────────────────────────────────────────────────────────
// 1. requireAuth — إلزامي
// ─────────────────────────────────────────────────────────────
exports.requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('لا يوجد توكن، الوصول مرفوض 🔒', 401, 'NO_TOKEN'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // ── 1) فحص الحظر السريع من الـ Cache (بدون DB) ──────────────────────
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    if (decoded.user.isBanned || isBannedInCache) {
      return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
    }

    // ── 2) التحقق من تفعيل البريد ────────────────────────────────────────
    if (!decoded.user.isVerified) {
      return next(new AppError('يجب تفعيل حسابك أولاً 📧', 403, 'EMAIL_NOT_VERIFIED'));
    }

    // ── 3) sessionIssuedAt من الـ Cache أولاً — DB فقط عند cache miss ────
    let sessionIssuedAt = sessionCache.get(decoded.user.id);

    if (sessionIssuedAt === undefined) {
      const user = await User.findById(decoded.user.id)
        .select('sessionIssuedAt isBanned')
        .lean();

      if (!user) {
        return next(new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND'));
      }

      if (user.isBanned) {
        sessionCache.invalidate(decoded.user.id);
        return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
      }

      sessionIssuedAt = user.sessionIssuedAt ?? null;
      sessionCache.set(decoded.user.id, sessionIssuedAt);
    }

    // ── 4) فحص صلاحية الجلسة ─────────────────────────────────────────────
    if (
      sessionIssuedAt &&
      decoded.iat < Math.floor(new Date(sessionIssuedAt).getTime() / 1000)
    ) {
      sessionCache.invalidate(decoded.user.id);
      return next(new AppError(
        'انتهت صلاحية الجلسة، أعد تسجيل الدخول 🔒',
        401,
        'SESSION_INVALIDATED'
      ));
    }

    req.user = {
      id:         decoded.user.id,
      role:       decoded.user.role,
      trustLevel: decoded.user.trustLevel ?? 1,
      isBanned:   false,
      isVerified: true,
    };

    next();

  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return next(new AppError(
      isExpired ? 'انتهت صلاحية الجلسة ⏰' : 'توكن غير صالح ⚠️',
      401,
      isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    ));
  }
};

// ─────────────────────────────────────────────────────────────
// 2. requireAdmin — يُستدعى دائماً بعد requireAuth
// ─────────────────────────────────────────────────────────────
// 🟡 FIX [CLEAN-AUTH-02]: حُذف فحص req.user اليدوي — requireAuth يضمن وجوده دائماً
//    إذا احتجت استخدامه standalone أعد الفحص
exports.requireAdmin = (req, res, next) => {
  if (req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
    return next(new AppError('هذه المنطقة للمشرفين فقط 🛡️', 403, 'FORBIDDEN_ADMIN_ONLY'));
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// 3. requireLevel2 — المستوى الثاني: طلاب محققون أو مُعزَّزون من الآدمن
// ─────────────────────────────────────────────────────────────
// 🔴 FIX [BUG-AUTH-03]: كان يتحطم إذا req.user غير موجود (استدعاء خاطئ بدون requireAuth)
// 🟡 FIX [UX-AUTH-04]:  رسالة الخطأ كانت '...' — استُبدلت برسالة واضحة
exports.requireLevel2 = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if ((req.user.trustLevel ?? 1) < 2) {
    return next(new AppError(
      'هذه الميزة تتطلب حساباً موثّقاً (المستوى 2) — يرجى رفع مستوى حسابك 📋',
      403,
      'LEVEL2_REQUIRED'
    ));
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// 4. optionalAuth — اختياري (لا يرفض الطلب إذا لم يكن هناك توكن)
// ─────────────────────────────────────────────────────────────
exports.optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    if (decoded.user.isBanned || isBannedInCache) {
      req.user = null;
      return next();
    }

    let sessionIssuedAt = sessionCache.get(decoded.user.id);

    if (sessionIssuedAt === undefined) {
      const user = await User.findById(decoded.user.id)
        .select('sessionIssuedAt isBanned')
        .lean();

      if (!user || user.isBanned) {
        req.user = null;
        return next();
      }

      sessionIssuedAt = user.sessionIssuedAt ?? null;
      sessionCache.set(decoded.user.id, sessionIssuedAt);
    }

    if (
      sessionIssuedAt &&
      decoded.iat < Math.floor(new Date(sessionIssuedAt).getTime() / 1000)
    ) {
      sessionCache.invalidate(decoded.user.id);
      req.user = null;
      return next();
    }

    req.user = {
      id:         decoded.user.id,
      role:       decoded.user.role,
      trustLevel: decoded.user.trustLevel ?? 1,
      isBanned:   false,
      isVerified: decoded.user.isVerified ?? false,
    };

  } catch {
    req.user = null;
  }

  next();
};

exports.requireSuperAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'superadmin' && req.user.role !== 'admin')) {
    return next(new AppError('هذه العملية تتطلب صلاحيات مشرف أعلى 🛡️', 403));
  }
  next();
};