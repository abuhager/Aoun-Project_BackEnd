// middlewares/auth.js
// ✅ FIX [SEC-01]: حذف دالة validateSession الميتة — كانت مُعرَّفة ولا تُستخدم أبداً

const AppError              = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache              = require('../utils/banCache');
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

    // ── 1) فحص الحظر السريع من الـ Cache أولاً (بدون DB) ────────────────
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    if (decoded.user.isBanned || isBannedInCache) {
      return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
    }

    // ── 2) التحقق من تفعيل البريد ──────────────────────────────────────
    if (!decoded.user.isVerified) {
      return next(new AppError('يجب تفعيل حسابك أولاً 📧', 403, 'EMAIL_NOT_VERIFIED'));
    }

    // ── 3) فحص sessionIssuedAt و isBanned من DB ─────────────────────────
    const user = await User.findById(decoded.user.id)
      .select('sessionIssuedAt isBanned')
      .lean();

    if (!user) {
      return next(new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND'));
    }

    // طبقة ثانية لفحص الحظر (الحظر اليدوي الجديد من الآدمن)
    if (user.isBanned) {
      return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
    }

    // فحص صلاحية الجلسة — نُطبَّق فقط إذا sessionIssuedAt موجود في DB
    if (
      user.sessionIssuedAt &&
      decoded.iat < Math.floor(user.sessionIssuedAt.getTime() / 1000)
    ) {
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

    const user = await User.findById(decoded.user.id)
      .select('sessionIssuedAt isBanned')
      .lean();

    if (!user || user.isBanned) {
      req.user = null;
      return next();
    }

    if (
      user.sessionIssuedAt &&
      decoded.iat < Math.floor(user.sessionIssuedAt.getTime() / 1000)
    ) {
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