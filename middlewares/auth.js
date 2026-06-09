// middlewares/auth.js
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache               = require('../utils/banCache');

// ─── 1. حماية المسارات العامة ─────────────────────────────────
exports.requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'لا يوجد توكن، الوصول مرفوض 🔒' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);

    // فحص الحظر من الـ payload + الـ Cache
    const isBannedInCache = await banCache.isUserBanned(decoded.user.id);

    if (decoded.user.isBanned || isBannedInCache) {
      return res.status(403).json({ msg: 'حسابك محظور 🚫' });
    }

    req.user = {
      id:         decoded.user.id,
      role:       decoded.user.role,
      trustLevel: decoded.user.trustLevel ?? 1,
      isBanned:   false,  // ✅ وصل هنا = اجتاز الفحص = غير محظور
    };

    next();

  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      msg:  isExpired ? 'انتهت صلاحية الجلسة ⏰' : 'توكن غير صالح ⚠️',
      code: isExpired ? 'TOKEN_EXPIRED'           : 'INVALID_TOKEN',
    });
  }
};

// ─── 2. مسارات الأدمن ─────────────────────────────────────────
exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: 'غير مصرح — يجب تسجيل الدخول أولاً 🔒' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ msg: 'هذه المنطقة للمشرفين فقط 🛡️' });
  }
  next();
};

// ─── 3. مسارات Level 2 ────────────────────────────────────────
exports.requireLevel2 = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: 'غير مصرح — يجب تسجيل الدخول أولاً 🔒' });
  }
  if ((req.user.trustLevel ?? 1) < 2) {
    return res.status(403).json({
      msg:  'يتطلب هذا الإجراء التحقق من الهوية (المستوى 2) 🔐',
      code: 'LEVEL2_REQUIRED',
    });
  }
  next();
};

// ─── 4. التحقق الاختياري ──────────────────────────────────────
exports.optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      id:         decoded.user.id,
      role:       decoded.user.role,
      trustLevel: decoded.user.trustLevel ?? 1,
      isBanned:   decoded.user.isBanned   ?? false,
    };
  } catch {
    req.user = null;
  }
  next();
};