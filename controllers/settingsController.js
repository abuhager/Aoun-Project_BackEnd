// controllers/settingsController.js
const settingsService = require('../services/settingsService');

exports.getSettings = async (req, res) => {
  try {
    const settings = await settingsService.getSettings();
    res.json(settings);
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const updated = await settingsService.updateSettings(req.body);
    res.json({ msg: 'تم تحديث الإعدادات ✅', settings: updated });
  } catch (err) {
    res.status(err.status ?? 500).json({ msg: err.message });
  }
};
