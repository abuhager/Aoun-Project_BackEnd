// middlewares/auth.js
// ✅ [FLOW2-FIX-01] requireAuth يفحص isFrozen الآن — مستخدم مجمَّد لا يمر مهما كان توكنه
// ✅ [FLOW2-FIX-09] optionalAuth — isBanned يدمج cache + token بشكل موثوق
// ✅ BUG-AUTH-CRIT: requireSuperAdmin يستخدم ROLES.SUPER_ADMIN الصحيح
// ✅ PERF-AUTH-01:  sessionCache يُلغي DB query في كل طلب

const AppError              = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache              = require('../utils/banCache');
const sessionCache          = require('../utils/sessionCache');
const User                  = require('../models/User');

const ROLES = {
  ADMIN:       'admin',
  SUPER_ADMIN: 'super_admin',
};
exports.ROLES = ROLES;

// ─────────────────────────────────────────────────────────────
// 1. requireAuth
// ─────────────────────────────────────────────────────────────
exports.requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('لا يوجد توكن، الوصول مرفوض 🔒', 401, 'NO_TOKEN'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // ── 1) فحص الحظر السريع ───────────────────────────────────
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    if (decoded.user.isBanned || isBannedInCache) {
      return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
    }

    // ── [FLOW2-FIX-01] فحص التجميد ──────────────────────────
    // المشكلة القديمة: مستخدم مجمَّد + access token صالح = وصول حر 15 دقيقة
    // الحل: نفحص isFrozen هنا قبل أي منطق آخر
    const isFrozenInCache = await banCache.isUserFrozen(decoded.user.id);
    if (isFrozenInCache) {
      return next(new AppError('حسابك مجمَّد مؤقتاً 🧊', 403, 'ACCOUNT_FROZEN'));
    }

    // ── 2) فحص تفعيل البريد ──────────────────────────────────
    if (!decoded.user.isVerified) {
      return next(new AppError('يجب تفعيل حسابك أولاً 📧', 403, 'EMAIL_NOT_VERIFIED'));
    }

    // ── 3) sessionIssuedAt من Cache → DB عند miss ─────────────
    let sessionIssuedAt = sessionCache.get(decoded.user.id);

    if (sessionIssuedAt === undefined) {
      // [FLOW2-FIX-01] أضف isFrozen لهذا الـ select
      const user = await User.findById(decoded.user.id)
        .select('sessionIssuedAt isBanned isFrozen')
        .lean();

      if (!user) {
        return next(new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND'));
      }

      if (user.isBanned) {
        banCache.add(decoded.user.id);
        sessionCache.invalidate(decoded.user.id);
        return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
      }

      // [FLOW2-FIX-01] فحص isFrozen من DB أيضاً
      if (user.isFrozen) {
        banCache.addFrozen(decoded.user.id); // خزّنه في cache لتسريع الطلبات التالية
        sessionCache.invalidate(decoded.user.id);
        return next(new AppError('حسابك مجمَّد مؤقتاً 🧊', 403, 'ACCOUNT_FROZEN'));
      }

      sessionIssuedAt = user.sessionIssuedAt ?? null;
      sessionCache.set(decoded.user.id, sessionIssuedAt);
    }

    // ── 4) فحص صلاحية الجلسة ─────────────────────────────────
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
      isFrozen:   false, // وصل لهنا = مؤكد ليس مجمَّداً
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
// 2. requireAdmin
// ─────────────────────────────────────────────────────────────
exports.requireAdmin = (req, res, next) => {
  if (req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
    return next(new AppError('هذه المنطقة للمشرفين فقط 🛡️', 403, 'FORBIDDEN_ADMIN_ONLY'));
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// 3. requireSuperAdmin
// ─────────────────────────────────────────────────────────────
exports.requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    return next(new AppError('هذه العملية تتطلب صلاحيات مشرف أعلى 🛡️', 403, 'FORBIDDEN_SUPER_ADMIN_ONLY'));
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// 4. requireLevel2
// ─────────────────────────────────────────────────────────────
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
// 5. optionalAuth
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

    // [FLOW2-FIX-09] يدمج cache + token لضمان الموثوقية
    if (decoded.user.isBanned || isBannedInCache) {
      req.user = null;
      return next();
    }

    // [FLOW2-FIX-01] فحص التجميد في optionalAuth أيضاً
    const isFrozenInCache = await banCache.isUserFrozen(decoded.user.id);
    if (isFrozenInCache) {
      req.user = null;
      return next();
    }

    let sessionIssuedAt = sessionCache.get(decoded.user.id);

    if (sessionIssuedAt === undefined) {
      const user = await User.findById(decoded.user.id)
        .select('sessionIssuedAt isBanned isFrozen') // [FLOW2-FIX-01] أضيف isFrozen
        .lean();

      if (!user || user.isBanned) {
        req.user = null;
        return next();
      }

      // [FLOW2-FIX-01]
      if (user.isFrozen) {
        banCache.addFrozen(decoded.user.id);
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
      // [FLOW2-FIX-09] يدمج cache + token بدل false ثابت
      isBanned:   isBannedInCache || decoded.user.isBanned || false,
      isFrozen:   false,
      isVerified: decoded.user.isVerified ?? false,
    };

  } catch {
    req.user = null;
  }

  next();
};