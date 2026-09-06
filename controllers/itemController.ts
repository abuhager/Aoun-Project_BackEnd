import itemService from '../services/itemService.js';
import type { DeliveryConfirmation, ItemInput } from '../services/itemService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getItems = asyncHandler(async (req, res) => {
  const result = await itemService.getItemsLogic(req.query);
  res.json(result);
});

export const getMyItems = asyncHandler(async (req, res) => {
  const result = await itemService.getMyItemsLogic(req.user!.id);
  res.json(result);
});

export const getItemById = asyncHandler(async (req, res) => {
  const requesterId = req.user?.id || req.user?._id || null;
  const result = await itemService.getItemByIdLogic(
    req.params.id,
    requesterId,
    req.user?.role ?? 'user'
  );
  res.json(result);
});

export const createItem = asyncHandler(async (req, res) => {
  const result = await itemService.createItemLogic(req.body as ItemInput, req.user!.id, req.file!);
  res.status(201).json({ success: true, ...result });
});

export const bookItem = asyncHandler(async (req, res) => {
  const result = await itemService.bookItemLogic(req.params.id, req.user!.id);
  res.status(200).json({ success: true, ...result });
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const result = await itemService.cancelBookingLogic(
    req.params.id,
    req.user!.id.toString()
  );
  res.json(result);
});

export const leaveWaitlist = asyncHandler(async (req, res) => {
  const result = await itemService.leaveWaitlistLogic(
    req.params.id,
    req.user!.id.toString()
  );
  res.json(result);
});

export const completeDelivery = asyncHandler(async (req, res) => {
  const rawConfirmationType = req.body.confirmationType;

  if (rawConfirmationType !== 'recipient_confirm' && rawConfirmationType !== 'donor_confirm') {
    return res.status(400).json({
      success: false,
      code:    'MISSING_CONFIRMATION_TYPE',
      msg:     'يجب إرسال confirmationType في الـ body',
    });
  }
  const confirmationType: DeliveryConfirmation = rawConfirmationType;

  // ✅ تأمين قاطع: قراءة المعرف المتاح في التوكن وسحبه كـ string صريح وسليم
  const currentUserId = String(req.user?._id ?? req.user?.id);

  const result = await itemService.completeDeliveryLogic(
    req.params.id,
    currentUserId, 
    confirmationType
  );

  res.json({ success: true, ...result });
});

export const updateItem = asyncHandler(async (req, res) => {
  const result = await itemService.updateItemLogic(
    req.params.id,
    req.user!.id,
    req.body as ItemInput,
    req.file
  );
  res.json(result);
});

export const deleteItem = asyncHandler(async (req, res) => {
  const result = await itemService.deleteItemLogic(
    req.params.id,
    req.user!.id
  );
  res.json(result);
});

export default { getItems, getMyItems, getItemById, createItem, bookItem, cancelBooking, leaveWaitlist, completeDelivery, updateItem, deleteItem };
