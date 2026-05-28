// controllers/itemController.js
const itemService = require('../services/itemService');
const { validateCreateItem } = require('../dtos/itemDto');
const Item = require('../models/Item');
const { getIo } = require('../socket'); // ✅ أضف هذا السطر

exports.getItems = async (req, res) => {
  try {
    const result = await itemService.getItemsLogic(req.query);
    res.json(result);
  } catch (err) {
    console.error('Pagination Error:', err.message);
    res.status(500).json({ msg: 'خطأ في السيرفر أثناء جلب الأغراض' });
  }
};

exports.getMyItems = async (req, res) => {
  try {
    const userId = req.user.id || req.user.id;
    const result = await itemService.getMyItemsLogic(userId);
    res.json(result);
  } catch (err) {
    console.error('Error in getMyItems:', err.message);
    res.status(500).json({ msg: 'خطأ في السيرفر أثناء جلب بياناتي' });
  }
};

// ✅ لا نفك الـ JWT يدوياً — OTP محذوف من كل response على أي حال
exports.getItemById = async (req, res) => {
  try {
    const requesterId = req.user?.id || req.user?._id || null;
    const result = await itemService.getItemByIdLogic(req.params.id, requesterId);
    res.json(result);
  } catch (err) {
    const status = err.message === 'الغرض غير موجود' ? 404 : 500;
    res.status(status).json({ msg: err.message || 'خطأ في السيرفر' });
  }
};

exports.createItem = async (req, res) => {
  try {
    const { error } = validateCreateItem(req.body);
    if (error)
      return res.status(400).json({ success: false, message: error.details[0].message });

    const userId = req.user.id || req.user.id;
    const result = await itemService.createItemLogic(req.body, userId, req.file);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('Create item error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.bookItem = async (req, res) => {
  try {
    const userId = req.user.id || req.user.id;
    const result = await itemService.bookItemLogic(req.params.id, userId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.cancelBooking = async (req, res) => {
  try {
    const result = await itemService.cancelBookingLogic(req.params.id, req.user.id.toString());
    res.json(result);
  } catch (err) {
    const status =
      err.message === 'الغرض غير موجود' ? 404 :
      err.message === 'غير مصرح لك'     ? 403 : 500;
    res.status(status).json({ msg: err.message || 'خطأ في السيرفر' });
  }
};

exports.completeDelivery = async (req, res) => {
  try {
    const result = await itemService.completeDeliveryLogic(req.params.id, req.user.id, req.body.otp);

    // ✅ أعلم كل المتصلين بتحديث الـ Leaderboard بعد اكتمال التسليم
    try { getIo().emit('leaderboard:update'); } catch {}

    res.json(result);
  } catch (err) {
    res.status(400).json({ msg: err.message || 'خطأ في التسليم' });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const result = await itemService.updateItemLogic(req.params.id, req.user.id, req.body, req.file);
    res.json(result);
  } catch (err) {
    res.status(404).json({ msg: err.message || 'فشل التعديل' });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const result = await itemService.deleteItemLogic(req.params.id, req.user.id, req.user.role);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('غير مصرح') ? 403 : 404;
    res.status(status).json({ msg: err.message || 'خطأ في الحذف' });
  }
};