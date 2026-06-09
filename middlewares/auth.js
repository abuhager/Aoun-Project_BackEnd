// middlewares/auth.js
const { verifyAccessToken } = require('../utils/tokenUtils');
const banCache = require('../utils/banCache'); // ✅ استيراد كاش الحظر (تأكد من مطابقة المسار لملف الـ Redis/Cache لديك)

// ─── 1. حماية المسارات العامة ─────────────────────────────────
// ✅ تم تحويل الدالة إلى async لتمكين استخدام await مع فحص الكاش
exports.requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'لا يوجد توكن، الوصول مرفوض 🔒' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // ✅ Fix Bug #7 — نتحقق من التوكن فقط، لا DB query للـ User نفسه
    const decoded = verifyAccessToken(token);

    // ✅ إصلاح ثغرة تأخير الحظر: فحص سريع من الـ Cache (الـ Redis) لمنع فجوة الـ 15 دقيقة
    const isBannedNow = await banCache.isUserBanned(decoded.user.id);

    if (decoded.user.isBanned || isBannedNow) {
      return res.status(403).json({ msg: 'حسابك محظور 🚫' });
    }

    req.user = {
      id:         decoded.user.id,
      role:       decoded.user.role,
      trustLevel: decoded.user.trustLevel ?? 1,  // ✅ متاح لكل controllers
      isBanned:   true, // إذا وصل هنا فالحساب سليم وغير محظور، لكن نؤكد القيمة
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
exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: 'غير مصرح — يجب تسجيل الدخول أولاً 🔒' });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ msg: 'هذه المنطقة للمشرفين فقط 🛡️' });
  }

  next();
};

// ─── 3. مسارات Level 2 (Phase 2 — stub جاهز) ─────────────────
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
    req.user = null; // توكن فاسد أو منتهي → يتم تجاهله في المسارات الاختيارية
  }
  next();
};