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

// ✅ NJ-09: يقبل levels مخصصة من SystemSettings أو يستخدم الافتراضية
const calcLevel = (trustScore, levels = DEFAULT_LEVELS) => {
  if (!levels || levels.length === 0) return DEFAULT_LEVELS[0];
  const score = Math.max(0, trustScore);
  return [...levels].reverse().find((l) => score >= l.minScore) ?? levels[0];
};

// ✅ NJ-10: حماية من أن levels تكون فارغة
const calcProgress = (trustScore, levels = DEFAULT_LEVELS) => {
  if (!levels || levels.length === 0) return { progress: 0, pointsToNext: null };

  const score     = Math.max(0, trustScore);
  const current   = calcLevel(score, levels);
  const nextLevel = levels.find((l) => l.level === current.level + 1);

  if (!nextLevel) return { progress: 100, pointsToNext: null };

  const range    = nextLevel.minScore - current.minScore;
  const achieved = score - current.minScore;

  return {
    progress:     Math.min(100, Math.round((achieved / range) * 100)),
    pointsToNext: nextLevel.minScore - score,
  };
};

// ✅ NJ-11: يقبل settings اختيارياً — إذا لم تأتِ يستخدم DEFAULT_LEVELS
const buildGamificationProfile = (trustScore, totalDonations, settings = null) => {
  // إذا كانت SystemSettings تحتوي على gamificationLevels استخدمها
  const levels    = settings?.gamificationLevels ?? DEFAULT_LEVELS;
  const levelInfo = calcLevel(trustScore, levels);
  const { progress, pointsToNext } = calcProgress(trustScore, levels);

  return {
    trustScore,
    totalDonations,
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
  // ✅ للتوافق مع الاستيرادات القديمة
  LEVELS: DEFAULT_LEVELS,
};
