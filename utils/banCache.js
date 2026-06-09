// utils/banCache.js
// stub مؤقت — جاهز للترقية لـ Redis لاحقاً

const bannedIds = new Set();

module.exports = {
  // ── CRUD ──────────────────────────────────────────
  add:    (userId) => bannedIds.add(String(userId)),
  delete: (userId) => bannedIds.delete(String(userId)),
  clear:  ()       => bannedIds.clear(),

  // ── فحص الحظر — async جاهزة لـ Redis لاحقاً ──────
  // ✅ الاسم الذي يستدعيه auth.js
  isUserBanned: async (userId) => bannedIds.has(String(userId)),

  // ✅ اسم مختصر للاستخدام الداخلي
  has: (userId) => bannedIds.has(String(userId)),
};