import settingsService from '../services/settingsService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  res.json(settings);
});

export const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getPublicSettings();

  res.setHeader('Cache-Control', 'no-store');
  res.json(settings);
});

export const updateSettings = asyncHandler(async (req, res) => {
  const result = await settingsService.updateSettings(req.body, req.user!.id);
  res.json({ msg: 'تم تحديث الإعدادات ✅', ...result });
});

export default { getSettings, getPublicSettings, updateSettings };
