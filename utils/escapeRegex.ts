// utils/escapeRegex.js
// ✅ يمنع ReDoS attack — يُستخدَم قبل كل new RegExp(userInput)

/**
 * يهرّب الأحرف الخاصة في RegExp + يحدّ الطول
 * @param {string} str - المدخل من المستخدم
 * @param {number} maxLen - الحد الأقصى للطول (افتراضي 100)
 * @returns {string}
 */
const escapeRegex = (str, maxLen = 100) => {
  if (typeof str !== 'string') return '';
  return str
    .slice(0, maxLen)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // هرّب كل أحرف RegExp الخاصة
};

module.exports = escapeRegex;
