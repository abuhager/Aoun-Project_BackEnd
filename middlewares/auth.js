// middlewares/auth.js

const AppError              = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache              = require('../utils/banCache');
const User                  = require('../models/User');

// ─────────────────────────────────────────────────────────────
// Helper: جلب بيانات المستخدم من DB مرة واحدة فقط عند الحاجة
// يُدمج فحص الحظر + sessionIssuedAt في query واحد
// ─────────────────────────────────────────────────────────────
async function validateSession(decoded) {
  // ✅ لو لا يوجد sessionIssuedAt في الـ payload → لا داعي لضرب DB
  // (يعني الـ token قديم صدر قبل إضافة هذه الميزة → نثق به)
  const needsDbCheck = !!decoded.user.sessionIssuedAt !== false;
  // decoded.iat دائماً موجود — لكن نضرب DB فقط إذا الـ payload لا يحمل تاريخ الجلسة
  // أو إذا احتجنا التحقق الأكيد من isBanned (banCache لا يكفي وحده)
  
  const user = await User.findById(decoded.user.id)
    .select('sessionIssuedAt isBanned')
    .lean();

  return user;
}

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

    // ── 3) فحص sessionIssuedAt — ضرب DB مرة واحدة فقط ─────────────────
    const user = await User.findById(decoded.user.id)
      .select('sessionIssuedAt isBanned')
      .lean();

    if (!user) {
      return next(new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND'));
    }

    // ✅ [BUG-2 FIX] استخدام isBanned من DB كطبقة ثانية (الحظر اليدوي الجديد)
    if (user.isBanned) {
      return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
    }

    // ✅ [BUG-1 FIX] sessionIssuedAt — نفحصه فقط إذا موجود في DB
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

    // ── فحص سريع من الـ Cache ────────────────────────────────────────────
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    if (decoded.user.isBanned || isBannedInCache) {
      req.user = null;
      return next();
    }

    // ✅ [BUG-3 FIX] فحص sessionIssuedAt في optionalAuth أيضاً
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