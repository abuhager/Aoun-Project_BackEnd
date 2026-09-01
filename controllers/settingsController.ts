// controllers/settingsController.js
const settingsService = require('../services/settingsService');
const asyncHandler    = require('../utils/asyncHandler');

// ✅ Admin فقط — الإعدادات الكاملة
exports.getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  res.json(settings);
});

// ✅ Public — بدون auth — يرجع فقط ما يحتاجه الـ Frontend
exports.getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getPublicSettings();

  res.setHeader('Cache-Control', 'no-store');
  res.json(settings);
});

// ✅ Admin فقط — تحديث الإعدادات
exports.updateSettings = asyncHandler(async (req, res) => {
  const result = await settingsService.updateSettings(req.body, req.user.id);
  res.json({ msg: 'تم تحديث الإعدادات ✅', ...result });
});
