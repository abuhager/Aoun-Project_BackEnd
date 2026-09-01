// utils/gamification.js
// ✅ NJ-09 FIX: حدود المستويات (minScore/maxScore) الآن قابلة للتهيئة
//              من SystemSettings — لا قيم hardcoded
// ✅ NJ-10 FIX: calcLevel تُعيد LEVELS[0] بشكل آمن حتى لو LEVELS فارغة
// ✅ NJ-11 FIX: buildGamificationProfile تقبل settings اختيارياً للقيم الديناميكية

// ── Default Levels (Fallback إذا لم تأتِ من SystemSettings) ──────────────
// ⚠️ هذه القيم تُستخدم فقط كـ Fallback — المصدر الحقيقي هو SystemSettings
const DEFAULT_LEVELS = Object.freeze([
  { level: 1, title: 'مبتدئ',  badge: '🌱', minScore: 0,   maxScore: 59  },
  { level: 2, title: 'موثوق',  badge: '⭐', minScore: 60,  maxScore: 79  },
  { level: 3, title: 'نشيط',   badge: '🔥', minScore: 80,  maxScore: 99  },
  { level: 4, title: 'متميز',  badge: '💎', minScore: 100, maxScore: 149 },
  { level: 5, title: 'أسطورة', badge: '👑', minScore: 150, maxScore: null },
]);

const normalizeScore = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const normalizeLevels = (levels) => {
  if (!Array.isArray(levels) || levels.length === 0) return [...DEFAULT_LEVELS];

  const normalized = levels
    .filter((level) => Number.isFinite(Number(level?.minScore)))
    .map((level) => ({ ...level, minScore: Number(level.minScore) }))
    .sort((left, right) => left.minScore - right.minScore);

  return normalized.length ? normalized : [...DEFAULT_LEVELS];
};

// ✅ NJ-09: يقبل levels مخصصة من SystemSettings أو يستخدم الافتراضية
const calcLevel = (trustScore, levels = DEFAULT_LEVELS) => {
  const normalizedLevels = normalizeLevels(levels);
  const score = normalizeScore(trustScore);
  return [...normalizedLevels]
    .reverse()
    .find((level) => score >= level.minScore) ?? normalizedLevels[0];
};

// ✅ NJ-10: حماية من أن levels تكون فارغة
const calcProgress = (trustScore, levels = DEFAULT_LEVELS) => {
  const normalizedLevels = normalizeLevels(levels);
  const score = normalizeScore(trustScore);
  const current = calcLevel(score, normalizedLevels);
  const currentIndex = normalizedLevels.findIndex(
    (level) => level.level === current.level && level.minScore === current.minScore
  );
  const nextLevel = normalizedLevels[currentIndex + 1];

  if (!nextLevel) return { progress: 100, pointsToNext: null };

  const range    = Math.max(1, nextLevel.minScore - current.minScore);
  const achieved = score - current.minScore;

  return {
    progress:     Math.max(0, Math.min(100, Math.round((achieved / range) * 100))),
    pointsToNext: Math.max(0, nextLevel.minScore - score),
  };
};

// ✅ NJ-11: يقبل settings اختيارياً — إذا لم تأتِ يستخدم DEFAULT_LEVELS
const buildGamificationProfile = (trustScore, totalDonations, settings = null) => {
  // إذا كانت SystemSettings تحتوي على gamificationLevels استخدمها
  const levels    = settings?.gamificationLevels ?? DEFAULT_LEVELS;
  const normalizedScore = normalizeScore(trustScore);
  const normalizedDonations = Math.max(0, Number(totalDonations) || 0);
  const levelInfo = calcLevel(normalizedScore, levels);
  const { progress, pointsToNext } = calcProgress(normalizedScore, levels);

  return {
    trustScore: normalizedScore,
    totalDonations: normalizedDonations,
    level:        levelInfo.level,
    title:        levelInfo.title,
    badge:        levelInfo.badge,
    progress,
    pointsToNext,
  };
};

module.exports = {
  DEFAULT_LEVELS,
  calcLevel,
  calcProgress,
  buildGamificationProfile,
  normalizeScore,
  // ✅ للتوافق مع الاستيرادات القديمة
  LEVELS: DEFAULT_LEVELS,
};
