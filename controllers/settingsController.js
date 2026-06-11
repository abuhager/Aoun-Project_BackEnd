// controllers/settingsController.js
const settingsService = require('../services/settingsService');
const asyncHandler    = require('../utils/asyncHandler');

// ✅ Admin فقط — الإعدادات الكاملة
exports.getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(settings);
});

// ✅ Public — بدون auth — يرجع فقط ما يحتاجه الـ Frontend
exports.getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings(); // ← نفس الدالة الموجودة

  const { categories, reportReasons } = settings ?? {};

  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.json({ categories: categories ?? [], reportReasons: reportReasons ?? [] });
});

// ✅ Admin فقط — تحديث الإعدادات
exports.updateSettings = asyncHandler(async (req, res) => {
  const updated = await settingsService.updateSettings(req.body);
  res.json({ msg: 'تم تحديث الإعدادات ✅', settings: updated });
});