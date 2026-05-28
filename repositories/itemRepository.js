// repositories/itemRepository.js

const Item   = require('../models/Item');
const Report = require('../models/Report');

// ─── جلب غرض للقراءة العامة ───────────────────────────────────
exports.findItemDetails = (itemId) =>
  Item.findById(itemId)
    .populate('donor',    'name avatar trustScore isVerifiedStudent trustLevel')
    .populate('bookedBy', 'name avatar')
    .populate('safeHub',  'name address city workingHours')
    .select('-deliveryOtp -__v');

// ─── جلب غرض للعمليات (حجز/إلغاء/تسليم) ─────────────────────
exports.findItemForAction = (itemId) =>
  Item.findById(itemId)
    .populate('safeHub', 'name address city workingHours')
    .select('+deliveryOtp');

// ─── جلب غرض للتعديل ─────────────────────────────────────────
exports.findItemForUpdate = (itemId, userId) =>
  Item.findOne({ _id: itemId, donor: userId })
    .populate('safeHub', 'name address city workingHours');

// ─── حذف غرض ─────────────────────────────────────────────────
exports.deleteItemById = (item) => item.deleteOne();

// ─── تبرعاتي كمتبرع ──────────────────────────────────────────
exports.findDonationsByUser = async (userId) => {
  const items = await Item.find({ donor: userId })
    .populate('bookedBy', 'name avatar trustScore isVerifiedStudent')
    .populate('safeHub',  'name city')
    .sort({ createdAt: -1 })
    .lean();

  // ✅ جلب البلاغات الـ pending على أغراضه
  const itemIds = items.map(i => i._id);
  const reports = await Report.find({
    relatedItem: { $in: itemIds },
    status:      'pending',
  }).select('relatedItem').lean();

  // ✅ map كل item بـ reportId تبعه
  const reportMap = {};
  reports.forEach(r => {
    reportMap[r.relatedItem.toString()] = r._id.toString();
  });

  return items.map(item => ({
    ...item,
    reportId: reportMap[item._id.toString()] ?? null,
  }));
};

// ─── طلبات الاستلام ───────────────────────────────────────────
exports.findReceivedByUser = (userId) =>
  Item.find({ bookedBy: userId })
    .populate('donor',   'name avatar trustScore isVerifiedStudent')
    .populate('safeHub', 'name address city workingHours')
    .sort({ createdAt: -1 })
    .lean();