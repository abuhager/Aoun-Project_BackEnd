// utils/tokenUtils.js
// ✅ إصلاح الثغرة #1: إضافة CLEAR_REFRESH_COOKIE_OPTIONS الناقص
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

// ── ثوابت الـ Cookie ──────────────────────────────────────────
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 أيام
  path:     '/',
};

// ✅ جديد — نفس الإعدادات بدون maxAge وبـ expires في الماضي
const CLEAR_REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path:     '/',
};

const generateAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m',
  });

const generateRefreshToken = (payload) => {
  const token  = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
  });
  // نخزّن hash الـ token في DB — ليس الـ token الأصلي
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hashed };
};

const verifyAccessToken  = (token) =>
  jwt.verify(token,  process.env.JWT_SECRET);

const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_REFRESH_COOKIE_OPTIONS, // ✅ مُصدَّر الآن
};