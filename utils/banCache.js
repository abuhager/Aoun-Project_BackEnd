// utils/banCache.js
// ✅ النسخة المصحّحة والمقاومة للـ Restart والـ Cluster Mode

const User = require('../models/User'); // استيراد موديل المستخدم للفحص عند غياب الكاش
const bannedIds = new Set();

module.exports = {
  // ── CRUD ──────────────────────────────────────────
  add:    (userId) => bannedIds.add(String(userId)),
  delete: (userId) => bannedIds.delete(String(userId)),
  clear:  ()       => bannedIds.clear(),

  // ── فحص الحظر — async جاهزة لـ Redis لاحقاً ──────
  // ✅ الاسم الذي يستدعيه الـ middleware (auth.js)
  isUserBanned: async (userId) => {
    const idStr = String(userId);

    // 1) فحص الكاش المحلي أولاً (استجابة فورية فائقة السرعة O(1))
    if (bannedIds.has(idStr)) return true;

    // 2) إذا لم يكن في الكاش (بسبب Restart أو توزيع الحمل بين الـ Clusters)، راجع الـ DB
    try {
      const user = await User.findById(idStr).select('isBanned').lean();
      
      if (user?.isBanned) {
        bannedIds.add(idStr); // إعادة إضافته للكاش المحلي لتسريع الطلبات القادمة للمستخدم
        return true;
      }
    } catch (error) {
      // تسجيل الخطأ لضمان استمرارية التطبيق في حال حدوث مشكلة مؤقتة في قاعدة البيانات
      console.error(`[BanCache Error] خطأ أثناء فحص حالة حظر المستخدم ${idStr}:`, error);
    }

    return false;
  },

  // ✅ اسم مختصر للاستخدام الداخلي السريع (يفحص الكاش المحلي فقط بشكل متزامن)
  has: (userId) => bannedIds.has(String(userId)),
};