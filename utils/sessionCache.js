// utils/sessionCache.js
// ✅ FIX [PERF-AUTH-01]: In-memory cache لـ sessionIssuedAt
// يُقلِّل DB queries في requireAuth من query/طلب → query/دقيقة لكل مستخدم
// TTL = 60 ثانية (قابل للضبط) — يُصفَّر فوراً عند logout أو تغيير كلمة المرور

const TTL_MS = parseInt(process.env.SESSION_CACHE_TTL_MS ?? '60000', 10) || 60_000;

/**
 * @type {Map<string, { sessionIssuedAt: Date | null, cachedAt: number }>}
 */
const _cache = new Map();

/**
 * جلب sessionIssuedAt من الـ Cache
 * @param {string} userId
 * @returns {Date | null | undefined} — undefined = غير موجود في الـ Cache
 */
const get = (userId) => {
  const entry = _cache.get(userId);
  if (!entry) return undefined; // cache miss

  if (Date.now() - entry.cachedAt > TTL_MS) {
    _cache.delete(userId);
    return undefined; // انتهت الصلاحية
  }

  return entry.sessionIssuedAt; // cache hit (قد تكون null لمستخدم بدون جلسة محددة)
};

/**
 * حفظ sessionIssuedAt في الـ Cache
 * @param {string} userId
 * @param {Date | null} sessionIssuedAt
 */
const set = (userId, sessionIssuedAt) => {
  _cache.set(userId, {
    sessionIssuedAt,
    cachedAt: Date.now(),
  });
};

/**
 * إبطال الـ Cache فوراً — يُستدعى عند:
 * - logout
 * - تغيير كلمة المرور (updatePasswordLogic)
 * - حظر المستخدم (banUser في adminService)
 * @param {string} userId
 */
const invalidate = (userId) => {
  _cache.delete(userId);
};

/**
 * إحصائيات للـ debugging (اختياري)
 */
const stats = () => ({
  size:    _cache.size,
  ttl_ms:  TTL_MS,
  entries: [..._cache.keys()],
});

module.exports = { get, set, invalidate, stats };