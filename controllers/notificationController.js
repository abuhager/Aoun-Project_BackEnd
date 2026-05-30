// controllers/notificationController.js
const notificationService = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');

exports.getNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.getNotificationsLogic(req.user.id);
  res.json(result);
});

exports.markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllReadLogic(req.user.id);
  res.json(result);
});

exports.markOneRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markOneReadLogic(
    req.params.id,
    req.user.id
  );
  res.json(result);
});