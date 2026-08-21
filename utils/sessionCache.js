// utils/sessionCache.js
// ✅ FIX [PERF-AUTH-01]: In-memory cache لـ sessionIssuedAt
// يُقلِّل DB queries في requireAuth من query/طلب → query/دقيقة لكل مستخدم
// TTL = 60 ثانية (قابل للضبط) — يُصفَّر فوراً عند logout أو تغيير كلمة المرور

const TTL_MS = parseInt(process.env.SESSION_CACHE_TTL_MS ?? '60000', 10) || 60_000;

/**
 * @type {Map<string, { state: object, cachedAt: number }>}
 */
const _cache = new Map();

/**
 * جلب sessionIssuedAt من الـ Cache
 * @param {string} userId
 * @returns {object | undefined} — undefined = غير موجود في الـ Cache
 */
const get = (userId) => {
  const key = String(userId);
  const entry = _cache.get(key);
  if (!entry) return undefined; // cache miss

  if (Date.now() - entry.cachedAt > TTL_MS) {
    _cache.delete(key);
    return undefined; // انتهت الصلاحية
  }

  return entry.state;
};

/**
 * حفظ sessionIssuedAt في الـ Cache
 * @param {string} userId
 * @param {object} state
 */
const set = (userId, state) => {
  _cache.set(String(userId), {
    state,
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
  _cache.delete(String(userId));
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
