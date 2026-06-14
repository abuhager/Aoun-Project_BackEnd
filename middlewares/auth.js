// middlewares/auth.js
// ✅ FIX [PERF-AUTH-01]: sessionCache يُلغي DB query في كل طلب لجلب sessionIssuedAt فقط
//    الآن: DB يُستدعى مرة واحدة كل 60 ثانية لكل مستخدم بدلاً من كل طلب

const AppError              = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache              = require('../utils/banCache');
const sessionCache          = require('../utils/sessionCache'); // ✅ FIX [PERF-AUTH-01]
const User                  = require('../models/User');

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

    // ── 3) ✅ FIX [PERF-AUTH-01]: sessionIssuedAt من الـ Cache أولاً ─────
    let sessionIssuedAt = sessionCache.get(decoded.user.id);

    if (sessionIssuedAt === undefined) {
      // cache miss — اذهب للـ DB مرة واحدة
      const user = await User.findById(decoded.user.id)
        .select('sessionIssuedAt isBanned')
        .lean();

      if (!user) {
        return next(new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND'));
      }

      // طبقة ثانية لفحص الحظر (الحظر اليدوي الجديد من الآدمن)
      if (user.isBanned) {
        sessionCache.invalidate(decoded.user.id); // تأكيد التصفير
        return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
      }

      sessionIssuedAt = user.sessionIssuedAt ?? null;
      sessionCache.set(decoded.user.id, sessionIssuedAt); // ✅ خزّن في الـ Cache
    }

    // ── 4) فحص صلاحية الجلسة ─────────────────────────────────────────────
    if (
      sessionIssuedAt &&
      decoded.iat < Math.floor(new Date(sessionIssuedAt).getTime() / 1000)
    ) {
      sessionCache.invalidate(decoded.user.id); // جلسة منتهية — صفّر الـ Cache
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
// 2. requireAdmin
// ─────────────────────────────────────────────────────────────
exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return next(new AppError('هذه المنطقة للمشرفين فقط 🛡️', 403, 'FORBIDDEN_ADMIN_ONLY'));
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// 3. requireLevel2
// ─────────────────────────────────────────────────────────────
exports.requireLevel2 = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if ((req.user.trustLevel ?? 1) < 2) {
    return next(new AppError(
      'يتطلب هذا الإجراء التحقق من الهوية (المستوى 2) 🔐',
      403,
      'LEVEL2_REQUIRED'
    ));
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// 4. optionalAuth — اختياري
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

    // ✅ FIX [PERF-AUTH-01]: نفس الـ Cache في optionalAuth
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

// 5. requireSuperAdmin — DC-05 FIX
//    للعمليات الحرجة التي تؤثر على النظام بالكامل
//    مثل: تعديل إعدادات النظام، تغيير حدود النظام
// ─────────────────────────────────────────────────────────────
exports.requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError(
      'غير مصرح — يجب تسجيل الدخول أولاً 🔒',
      401,
      'UNAUTHORIZED'
    ));
  }

  if (req.user.role !== 'super_admin') {
    return next(new AppError(
      'هذه العملية تتطلب صلاحيات مشرف أعلى 🛡️',
      403,
      'FORBIDDEN_SUPER_ADMIN_ONLY'
    ));
  }

  next();
};