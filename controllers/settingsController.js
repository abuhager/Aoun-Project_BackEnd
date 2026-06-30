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
  const settings = await settingsService.getSettings();
  const { categories, reportReasons, platformName, contactEmail } = settings ?? {};

  // ❌ مش Cache-Control عشاني نضمن أن التغييرات تظهر فوراً
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    categories:    categories    ?? [],
    reportReasons: reportReasons ?? [],
    platformName:  platformName  ?? 'عون',
    contactEmail:  contactEmail  ?? 'aoun.help.center@gmail.com',
  });
});

// ✅ Admin فقط — تحديث الإعدادات
exports.updateSettings = asyncHandler(async (req, res) => {
  const updated = await settingsService.updateSettings(req.body);
  res.json({ msg: 'تم تحديث الإعدادات ✅', settings: updated });
});