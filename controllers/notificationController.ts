import asyncHandler from '../utils/asyncHandler.js';
import notificationService from '../services/notificationService.js';

export const getNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.getNotificationsLogic(
    req.user!.id,
    { limit: req.query.limit }
  );
  res.json(result);
});

export const markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllReadLogic(req.user!.id);
  res.json(result);
});

export const markOneRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markOneReadLogic(
    req.params.id,
    req.user!.id
  );
  res.json(result);
});

export default { getNotifications, markAllRead, markOneRead };
