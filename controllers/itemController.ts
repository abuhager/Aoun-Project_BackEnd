// controllers/itemController.js — ✅ CLEANED & FIXED FROM OLD SOCKET PATH
const itemService  = require('../services/itemService');
const asyncHandler = require('../utils/asyncHandler');

// 💡 تم حذف سطر getIO القديم بالكامل لأنه استُبدل بـ الـ Middleware الموحد في server.ts

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
  const result = await itemService.getItemByIdLogic(
    req.params.id,
    requesterId,
    req.user?.role ?? 'user'
  );
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

// ✅ [WARN-1 FIX] دالة مستقلة لانسحاب Level1 من الـ Waitlist
// كانت مدموجة داخل cancelBookingLogic وكانت requireLevel2 تمنعها
exports.leaveWaitlist = asyncHandler(async (req, res) => {
  const result = await itemService.leaveWaitlistLogic(
    req.params.id,
    req.user.id.toString()
  );
  res.json(result);
});

exports.completeDelivery = asyncHandler(async (req, res) => {
  const { confirmationType } = req.body;

  if (!confirmationType) {
    return res.status(400).json({
      success: false,
      code:    'MISSING_CONFIRMATION_TYPE',
      msg:     'يجب إرسال confirmationType في الـ body',
    });
  }

  // ✅ تأمين قاطع: قراءة المعرف المتاح في التوكن وسحبه كـ string صريح وسليم
  const currentUserId = req.user?._id || req.user?.id;

  const result = await itemService.completeDeliveryLogic(
    req.params.id,
    currentUserId, 
    confirmationType
  );

  res.json({ success: true, ...result });
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
    req.user.id
  );
  res.json(result);
});
