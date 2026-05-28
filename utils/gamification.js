// utils/gamification.js

const LEVELS = [
  { level: 1, title: 'مبتدئ',  badge: '🌱', minScore: 0,   maxScore: 59  },
  { level: 2, title: 'موثوق',  badge: '⭐', minScore: 60,  maxScore: 79  },
  { level: 3, title: 'نشيط',   badge: '🔥', minScore: 80,  maxScore: 99  },
  { level: 4, title: 'متميز',  badge: '💎', minScore: 100, maxScore: 149 },
  { level: 5, title: 'أسطورة', badge: '👑', minScore: 150, maxScore: null },
];

const calcLevel = (trustScore) => {
  const score = Math.max(0, trustScore);
  return [...LEVELS].reverse().find((l) => score >= l.minScore) ?? LEVELS[0];
};

const calcProgress = (trustScore) => {
  const score     = Math.max(0, trustScore);
  const current   = calcLevel(score);
  const nextLevel = LEVELS.find((l) => l.level === current.level + 1);

  if (!nextLevel) return { progress: 100, pointsToNext: null };

  const range    = nextLevel.minScore - current.minScore;
  const achieved = score - current.minScore;

  return {
    progress:     Math.min(100, Math.round((achieved / range) * 100)),
    pointsToNext: nextLevel.minScore - score,
  };
};

const buildGamificationProfile = (trustScore, totalDonations) => {
  const levelInfo = calcLevel(trustScore);
  const { progress, pointsToNext } = calcProgress(trustScore);

  return {
    trustScore,
    totalDonations,
    level:       levelInfo.level,
    title:       levelInfo.title,
    badge:       levelInfo.badge,
    progress,
    pointsToNext,
  };
};

module.exports = { LEVELS, calcLevel, calcProgress, buildGamificationProfile };