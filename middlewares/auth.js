// middlewares/auth.js
// ✅ Phase 1 Fix:
//    Bug #7  — حذف DB query من كل طلب، نقرأ من JWT payload مباشرة
//    Bug #17 — requireAdmin يتحقق من req.user أولاً (يعتمد على requireAuth)

const { verifyAccessToken } = require('../utils/tokenUtils');

// ─── 1. حماية المسارات العامة ─────────────────────────────────
exports.requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'لا يوجد توكن، الوصول مرفوض 🔒' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // ✅ Fix Bug #7 — نتحقق من التوكن فقط، لا DB query
    const decoded = verifyAccessToken(token);

    // ✅ Fix Bug #7 — isBanned موجود في الـ payload الآن (من tokenUtils المُصلَح)
    // لا حاجة لـ User.findById في كل طلب
    if (decoded.user.isBanned) {
      return res.status(403).json({ msg: 'حسابك محظور 🚫' });
    }

    req.user = {
      id:         decoded.user.id,
      role:       decoded.user.role,
      trustLevel: decoded.user.trustLevel ?? 1,  // ✅ جديد — متاح لكل controllers
      isBanned:   decoded.user.isBanned   ?? false,
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
// ✅ Fix Bug #17 — requireAdmin يعتمد على requireAuth حتمًا قبله في الـ route
// يفحص req.user الذي زرعه requireAuth — لا يعمل وحده
exports.requireAdmin = (req, res, next) => {
  // إذا استُدعي requireAdmin بدون requireAuth قبله → req.user = undefined → 401
  if (!req.user) {
    return res.status(401).json({ msg: 'غير مصرح — يجب تسجيل الدخول أولاً 🔒' });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ msg: 'هذه المنطقة للمشرفين فقط 🛡️' });
  }

  next();
};

// ─── 3. مسارات Level 2 (Phase 2 — stub جاهز) ─────────────────
// ✅ الـ middleware جاهز الآن — يقرأ trustLevel من req.user (من الـ JWT payload)
// لا DB query — سريع ومباشر
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
exports.optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null; // ← لا مستخدم، لكن الطلب يكمل
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
    req.user = null; // ← token فاسد → نتجاهله
  }
  next();
};