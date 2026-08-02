// utils/banCache.js
// ✅ [FLOW2-FIX-01] إضافة isUserFrozen — يحل مشكلة مستخدم مجمَّد يتجاوز requireAuth
// ✅ BUG-02: lazy require داخل isUserBanned/isUserFrozen لحل Circular Dependency
// ✅ PERF-01: TTL تلقائي كل 5 دقائق (قابل للضبط من env)

const bannedIds = new Set();
const frozenIds = new Set(); // ← [FLOW2-FIX-01] جديد

const BAN_CACHE_TTL_MS = parseInt(process.env.BAN_CACHE_TTL_MS || String(5 * 60 * 1000));
setInterval(() => {
  bannedIds.clear();
  frozenIds.clear(); // ← [FLOW2-FIX-01] يُفرَّغ مع bannedIds
}, BAN_CACHE_TTL_MS).unref();

module.exports = {
  // ── Banned ────────────────────────────────────────────────
  add:    (userId) => bannedIds.add(String(userId)),
  delete: (userId) => bannedIds.delete(String(userId)),
  clear:  ()       => bannedIds.clear(),
  has:    (userId) => bannedIds.has(String(userId)),

  // ── [FLOW2-FIX-01] Frozen ─────────────────────────────────
  addFrozen:    (userId) => frozenIds.add(String(userId)),
  deleteFrozen: (userId) => frozenIds.delete(String(userId)),
  hasFrozen:    (userId) => frozenIds.has(String(userId)),

  // ── isUserBanned: فحص شامل (cache + DB) ──────────────────
  isUserBanned: async (userId) => {
    const idStr = String(userId);
    if (bannedIds.has(idStr)) return true;
    try {
      const User = require('../models/User'); // lazy require — يحل Circular Dependency
      const user = await User.findById(idStr).select('isBanned').lean();
      if (user?.isBanned) {
        bannedIds.add(idStr);
        return true;
      }
    } catch (error) {
      console.error(`[BanCache] خطأ أثناء فحص حظر المستخدم ${idStr}:`, error.message);
    }
    return false;
  },

  // ── [FLOW2-FIX-01] isUserFrozen: نفس منطق isUserBanned تماماً ──
  isUserFrozen: async (userId) => {
    const idStr = String(userId);

    // 1) فحص cache المحلي أولاً — O(1)
    if (frozenIds.has(idStr)) return true;

    // 2) cache miss → فحص DB
    try {
      const User = require('../models/User'); // lazy require
      const user = await User.findById(idStr).select('isFrozen').lean();
      if (user?.isFrozen) {
        frozenIds.add(idStr); // أعد تخزينه
        return true;
      }
    } catch (error) {
      // fail-open: يمر المستخدم في حالة خطأ DB — سيُطبَّق التجميد في أول طلب ناجح
      console.error(`[BanCache] خطأ أثناء فحص تجميد المستخدم ${idStr}:`, error.message);
    }
    return false;
  },
};