// utils/phoneUtils.js — [FLOW2-FIX-08] ملف جديد لتوحيد منطق التحقق من الهاتف
// المشكلة القديمة: PHONE_REGEX معرَّف بشكل مختلف في authController.js و validateBody.js
//   authController: /^\+9627[5789]\d{7}$/ (مخصص للأردن)
//   validateBody:   /^\+?[0-9]{7,15}$/    (عام جداً)
// الحل: مصدر حقيقة واحد — كل ملف يستورد من هنا

/**
 * أرقام الجوال الأردنية: +962 ثم 77/78/79 ثم 7 أرقام
 * أمثلة صحيحة: +96279xxxxxxx, +96278xxxxxxx, +96277xxxxxxx
 */
const JORDAN_PHONE_REGEX = /^\+9627[789]\d{7}$/;

/**
 * أرقام عامة: + اختياري ثم 7-15 رقم
 * للاستخدام في حقول الهاتف غير الإلزامية
 */
const GENERAL_PHONE_REGEX = /^\+?[0-9]{7,15}$/;

/**
 * تحقق من رقم أردني صالح
 * @param {string} phone
 * @returns {boolean}
 */
const isValidJordanPhone = (phone) => JORDAN_PHONE_REGEX.test(String(phone ?? ''));

/**
 * تحقق من رقم عام صالح
 * @param {string} phone
 * @returns {boolean}
 */
const isValidGeneralPhone = (phone) => GENERAL_PHONE_REGEX.test(String(phone ?? ''));

/**
 * تطبيع رقم الهاتف الأردني:
 * 07xxxxxxxx → +96207xxxxxxxx (غير صالح)
 * 07[5789]xxxxxxx → +9627[5789]xxxxxxx ✅
 * @param {string} phone
 * @returns {string}
 */
const normalizeJordanPhone = (phone) => {
  const cleaned = String(phone ?? '').replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+962')) return cleaned;
  if (cleaned.startsWith('00962')) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('07'))   return `+962${cleaned.slice(1)}`;
  if (cleaned.startsWith('7'))    return `+962${cleaned}`;
  return cleaned;
};

module.exports = {
  JORDAN_PHONE_REGEX,
  GENERAL_PHONE_REGEX,
  isValidJordanPhone,
  isValidGeneralPhone,
  normalizeJordanPhone,
};
