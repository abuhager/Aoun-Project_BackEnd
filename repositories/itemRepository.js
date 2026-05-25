// repositories/itemRepository.js

const Item = require('../models/Item');

// ─── جلب غرض للقراءة العامة ───────────────────────────────────
exports.findItemDetails = (itemId) =>
  Item.findById(itemId)
    .populate('donor',    'name avatar trustScore isVerifiedStudent trustLevel')
    .populate('bookedBy', 'name avatar')
    .populate('safeHub',  'name address city workingHours') // ✅ إضافة
    .select('-deliveryOtp -__v');


// ─── جلب غرض للعمليات (حجز/إلغاء/تسليم) ─────────────────────
exports.findItemForAction = (itemId) =>
  Item.findById(itemId)
    .populate('safeHub', 'name address city workingHours') // ✅ إضافة — يُستخدم في email الحجز
    .select('+deliveryOtp');


// ─── جلب غرض للتعديل ─────────────────────────────────────────
exports.findItemForUpdate = (itemId, userId) =>
  Item.findOne({ _id: itemId, donor: userId })
    .populate('safeHub', 'name address city workingHours'); // ✅ إضافة — لعرضه في صفحة التعديل


// ─── حذف غرض ─────────────────────────────────────────────────
exports.deleteItemById = (item) => item.deleteOne();


// ─── تبرعاتي كمتبرع ──────────────────────────────────────────
exports.findDonationsByUser = (userId) =>
  Item.find({ donor: userId })
    .populate('bookedBy', 'name avatar trustScore isVerifiedStudent')
    .populate('safeHub',  'name city') // ✅ إضافة — اسم + مدينة كافيان في الـ dashboard
    .sort({ createdAt: -1 })
    .lean();


// ─── طلبات الاستلام ───────────────────────────────────────────
exports.findReceivedByUser = (userId) =>
  Item.find({ bookedBy: userId })
    .populate('donor',   'name avatar trustScore isVerifiedStudent')
    .populate('safeHub', 'name address city workingHours') // ✅ إضافة — المستلم يحتاج العنوان كاملاً
    .sort({ createdAt: -1 })
    .lean();


// ─── تقييم معلق ──────────────────────────────────────────────
exports.findPendingRating = (userId) =>
  Item.findOne({
    bookedBy: userId,
    status:   'تم التسليم',
    isRated:  false,
  })
    .populate('donor',   'name avatar trustScore')
    // ❌ safeHub غير مطلوب هنا — شاشة التقييم لا تعرض بيانات المركز
    .select('-deliveryOtp -__v')
    .lean();