// controllers/settingsController.js
const settingsService = require('../services/settingsService');
const asyncHandler = require('../utils/asyncHandler');

exports.getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  res.json(settings);
});

exports.updateSettings = asyncHandler(async (req, res) => {
  const updated = await settingsService.updateSettings(req.body);
  res.json({
    msg: 'تم تحديث الإعدادات ✅',
    settings: updated,
  });
});