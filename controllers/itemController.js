// controllers/itemController.js
const itemService = require('../services/itemService');
const asyncHandler = require('../utils/asyncHandler');
const { getIO } = require('../socket/socketHandler');

exports.getItems = asyncHandler(async (req, res) => {
  const result = await itemService.getItemsLogic(req.query);
  res.json(result);
});

exports.getMyItems = asyncHandler(async (req, res) => {
  const result = await itemService.getMyItemsLogic(req.user.id);
  res.json(result);
});

exports.getItemById = asyncHandler(async (req, res) => {
  const requesterId = req.user?.id || req.user?._id || null;
  const result = await itemService.getItemByIdLogic(req.params.id, requesterId);
  res.json(result);
});

exports.createItem = asyncHandler(async (req, res) => {
  const result = await itemService.createItemLogic(req.body, req.user.id, req.file);
  res.status(201).json({ success: true, ...result });
});

exports.bookItem = asyncHandler(async (req, res) => {
  const result = await itemService.bookItemLogic(req.params.id, req.user.id);
  res.status(200).json({ success: true, ...result });
});

exports.cancelBooking = asyncHandler(async (req, res) => {
  const result = await itemService.cancelBookingLogic(
    req.params.id,
    req.user.id.toString()
  );
  res.json(result);
});

exports.completeDelivery = asyncHandler(async (req, res) => {
  // ✅ إذا وصل الطلب عبر confirm-receipt، نحدد النوع تلقائياً
  const confirmationType =
    req.body?.confirmationType ??
    (req.path.includes('confirm-receipt') ? 'recipient_confirm' : undefined);

  const result = await itemService.completeDeliveryLogic(
    req.params.id,
    req.user.id,
    confirmationType
  );

  if (result?.status === 'delivered' || result?.msg?.includes('إتمام')) {
    try {
      getIO().to('leaderboard_subscribers').emit('leaderboard:update');
    } catch (_) {}
  }

  res.json(result);
});

exports.updateItem = asyncHandler(async (req, res) => {
  const result = await itemService.updateItemLogic(
    req.params.id,
    req.user.id,
    req.body,
    req.file
  );
  res.json(result);
});

exports.deleteItem = asyncHandler(async (req, res) => {
  const result = await itemService.deleteItemLogic(
    req.params.id,
    req.user.id,
    req.user.role
  );
  res.json(result);
});