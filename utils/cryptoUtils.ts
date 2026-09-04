import crypto from 'node:crypto';

/**
 * توليد هاش SHA-256 آمن لأي توكن قبل تخزينه في قاعدة البيانات
 * @param {string} token - التوكن الصريح المراد تشفيره
 * @returns {string} الهاش المشفر بنظام hex
 */
const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const cryptoUtils = {
  hashToken,
};

export = cryptoUtils;
