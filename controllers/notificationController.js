// controllers/notificationController.js
const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');

exports.getNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.getNotificationsLogic(
    req.user.id,
    { limit: req.query.limit }
  );
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
