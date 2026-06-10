// middlewares/auth.js
// ✅ النسخة المصحّحة والمؤمنة بالكامل باستخدام AppError

const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache              = require('../utils/banCache');
const User        = require('../models/User'); // ✅ أضف هذا


// ─── 1. حماية المسارات العامة (الإلزامية) ─────────────────────
exports.requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('لا يوجد توكن، الوصول مرفوض 🔒', 401, 'NO_TOKEN'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // 1) فحص الحظر من الـ payload + الـ Cache
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    if (decoded.user.isBanned || isBannedInCache) {
      return next(new AppError('حسابك محظور 🚫', 403, 'USER_BANNED'));
    }

    // 2) التحقق من تفعيل البريد الإلكتروني
    if (!decoded.user.isVerified) {
      return next(new AppError('يجب تفعيل حسابك أولاً 📧', 403, 'EMAIL_NOT_VERIFIED'));
    }

    // ✅ 3) فحص sessionIssuedAt — إبطال الـ tokens الصادرة قبل تغيير كلمة المرور
    if (decoded.iat) {
      const user = await User.findById(decoded.user.id)
        .select('sessionIssuedAt isBanned')
        .lean();

      if (!user) {
        return next(new AppError('المستخدم غير موجود', 401, 'USER_NOT_FOUND'));
      }

      if (
        user.sessionIssuedAt &&
        decoded.iat < Math.floor(user.sessionIssuedAt.getTime() / 1000)
      ) {
        return next(new AppError('انتهت صلاحية الجلسة، أعد تسجيل الدخول 🔒', 401, 'SESSION_INVALIDATED'));
      }
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

// ─── 2. مسارات الأدمن ─────────────────────────────────────────
exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return next(new AppError('هذه المنطقة للمشرفين فقط 🛡️', 403, 'FORBIDDEN_ADMIN_ONLY'));
  }
  next();
};

// ─── 3. مسارات Level 2 ────────────────────────────────────────
exports.requireLevel2 = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('غير مصرح — يجب تسجيل الدخول أولاً 🔒', 401, 'UNAUTHORIZED'));
  }
  if ((req.user.trustLevel ?? 1) < 2) {
    return next(new AppError('يتطلب هذا الإجراء التحقق من الهوية (المستوى 2) 🔐', 403, 'LEVEL2_REQUIRED'));
  }
  next();
};

// ─── 4. التحقق الاختياري (تعديل S-04 ليدعم الـ async والفحص الفوري) ───
exports.optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    
    // ✅ إصلاح ثغرة S-04 — فحص حالة الحظر من الكاش وقاعدة البيانات فوراً
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);
    const isBanned = decoded.user.isBanned || isBannedInCache;

    // إذا كان محظوراً، نجرده من صلاحياته ويعامل كـ "زائر غير مسجل" حمايةً للمسار الإختياري
    req.user = isBanned ? null : {
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