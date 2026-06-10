// utils/cryptoUtils.js
// ✅ ملف الأدوات التشفيرية الموحد للمشروع
const crypto = require('crypto');

/**
 * توليد هاش SHA-256 آمن لأي توكن قبل تخزينه في قاعدة البيانات
 * @param {string} token - التوكن الصريح المراد تشفيره
 * @returns {string} الهاش المشفر بنظام hex
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
  hashToken,
};