// utils/banCache.js — النسخة المصحّحة (Flow-1 Audit)
// ✅ إصلاح BUG-02: lazy require داخل isUserBanned لحل Circular Dependency مع User model
// ✅ إصلاح PERF-01: TTL تلقائي كل 5 دقائق لإجبار refresh من DB في بيئة multi-instance

const bannedIds = new Set();

// ─────────────────────────────────────────────────────────────
// ✅ PERF-01: TTL — كل 5 دقائق يُفرَّغ الكاش المحلي ليُعاد بناؤه من DB
// هذا حل مؤقت آمن يضمن أن الحظر ينعكس على جميع instances خلال ≤5 دقائق
// الحل الدائم: استبدل هذا الـ Set بـ Redis عند الانتقال إلى multi-instance
// ⚠️ TODO-PROD: npm install ioredis ثم نقل المنطق إلى config/redis.js
// ─────────────────────────────────────────────────────────────
const BAN_CACHE_TTL_MS = parseInt(process.env.BAN_CACHE_TTL_MS || String(5 * 60 * 1000));
setInterval(() => {
  bannedIds.clear();
}, BAN_CACHE_TTL_MS).unref(); // .unref() يمنع الـ interval من إبقاء العملية حيّة

module.exports = {
  // ── CRUD ──────────────────────────────────────────────────
  add:    (userId) => bannedIds.add(String(userId)),
  delete: (userId) => bannedIds.delete(String(userId)),
  clear:  ()       => bannedIds.clear(),

  // ── فحص سريع متزامن (O(1)) — للاستخدام الداخلي فقط ──────
  has: (userId) => bannedIds.has(String(userId)),

  // ─────────────────────────────────────────────────────────
  // isUserBanned: الدالة الرئيسية التي يستدعيها auth middleware
  // ✅ BUG-02: lazy require — يحل مشكلة Circular Dependency
  //    banCache ← auth.js ← routes ← models/User
  //    لو استوردنا User في أعلى الملف، قد يُحمَّل قبل اكتمال تهيئة Mongoose
  // ─────────────────────────────────────────────────────────
  isUserBanned: async (userId) => {
    const idStr = String(userId);

    // 1) فحص الكاش المحلي أولاً — استجابة فورية O(1) بدون DB
    if (bannedIds.has(idStr)) return true;

    // 2) إذا غاب من الكاش (بعد TTL أو Restart أو instance جديد) → راجع DB
    try {
      // ✅ BUG-02: lazy require بدل top-level import
      const User = require('../models/User');
      const user = await User.findById(idStr).select('isBanned').lean();

      if (user?.isBanned) {
        bannedIds.add(idStr); // أعد إضافته للكاش لتسريع الطلبات القادمة لهذا المستخدم
        return true;
      }
    } catch (error) {
      // لا نوقف التطبيق — نسجّل ونتجاهل (fail-open: المستخدم يمر في حالة خطأ DB)
      // هذا مقبول لأن الحظر من DB سيُطبَّق في أول طلب ناجح
      console.error(`[BanCache] خطأ أثناء فحص حظر المستخدم ${idStr}:`, error.message);
    }

    return false;
  },
};
