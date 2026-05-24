// repositories/itemRepository.js
// ✅ Phase 1 Fixes:
//    Bug #18 — findDonationsByUser: حذف email + phone من populate
//    Bug #21 — findItemDetails: لا نجلب deliveryOtp إلا للمتبرع (يُتحكم فيه في الـ service)

const Item = require('../models/Item');

// ─── جلب غرض للقراءة العامة (لا OTP) ─────────────────────────
exports.findItemDetails = (itemId) =>
  Item.findById(itemId)
    .populate('donor',    'name avatar trustScore isVerifiedStudent trustLevel')
    .populate('bookedBy', 'name avatar')
    // ✅ Fix Bug #21 — لا نجلب deliveryOtp هنا إطلاقاً
    // إذا احتاج المتبرع الـ OTP، يستخدم findItemForAction
    .select('-deliveryOtp -__v');

// ─── جلب غرض للعمليات (حجز/إلغاء/تسليم) — يحتاج OTP ──────────
exports.findItemForAction = (itemId) =>
  Item.findById(itemId).select('+deliveryOtp');

// ─── جلب غرض للتعديل — مع التحقق من الملكية ──────────────────
exports.findItemForUpdate = (itemId, userId) =>
  Item.findOne({ _id: itemId, donor: userId });

// ─── حذف غرض ─────────────────────────────────────────────────
exports.deleteItemById = (item) => item.deleteOne();

// ─── تبرعاتي كمتبرع ──────────────────────────────────────────
exports.findDonationsByUser = (userId) =>
  Item.find({ donor: userId })
    .populate(
      'bookedBy',
      // ✅ Fix Bug #18 — حذف email + phone من الـ payload العام
      'name avatar trustScore isVerifiedStudent'
      // ❌ كان: 'name avatar trustScore email phone isVerifiedStudent'
    )
    .sort({ createdAt: -1 })
    .lean();

// ─── طلبات الاستلام ───────────────────────────────────────────
exports.findReceivedByUser = (userId) =>
  Item.find({ bookedBy: userId })
    .populate('donor', 'name avatar trustScore isVerifiedStudent')
    .sort({ createdAt: -1 })
    .lean();

// ─── تقييم معلق ──────────────────────────────────────────────
exports.findPendingRating = (userId) =>
  Item.findOne({
    bookedBy: userId,
    status:   'تم التسليم',
    isRated:  false,
  })
    .populate('donor', 'name avatar trustScore')
    .select('-deliveryOtp -__v')
    .lean();
    