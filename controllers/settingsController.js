// controllers/settingsController.js
const settingsService = require('../services/settingsService');
const asyncHandler = require('../utils/asyncHandler');

exports.getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();

  res.setHeader(
    'Cache-Control', 
    'public, max-age=60, stale-while-revalidate=300'
  );

  res.json(settings);
});

exports.updateSettings = asyncHandler(async (req, res) => {
  const updated = await settingsService.updateSettings(req.body);

  // عند التحديث، لا نضع Cache-Control لضمان عدم كش الحفظ
  res.json({
    msg: 'تم تحديث الإعدادات ✅',
    settings: updated,
  });
});