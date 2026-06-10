// repositories/itemRepository.js

const Item   = require('../models/Item');
const Report = require('../models/Report');

// ─── جلب غرض للقراءة العامة ───────────────────────────────────
exports.findItemDetails = (itemId) =>
  Item.findById(itemId)
    .populate('donor',    'name avatar trustScore isVerifiedStudent trustLevel')
    .populate('bookedBy', 'name avatar')
    .populate('safeHub',  'name address city workingHours')
    .select('-__v');

// ─── جلب غرض للعمليات (حجز/إلغاء/تسليم) ─────────────────────
exports.findItemForAction = (itemId) =>
  Item.findById(itemId)
    .populate('safeHub', 'name address city workingHours');
    

// ─── جلب غرض للتعديل ─────────────────────────────────────────
exports.findItemForUpdate = (itemId, userId) =>
  Item.findOne({ _id: itemId, donor: userId })
    .populate('safeHub', 'name address city workingHours');

// ─── حذف غرض ─────────────────────────────────────────────────
exports.deleteItemById = (item) => item.deleteOne();

// ─── helper: يربط reportId بكل item ──────────────────────────
// reportedUserId → اختياري، يُضيّق البحث للمستلم فقط
async function attachReportIds(items, reportedUserId) {
  if (!items.length) return items;

  const itemIds = items.map(i => i._id);

  // ✅ نبحث بـ relatedItem فقط — نتجاهل البلاغات بدون غرض
  const query = {
    relatedItem: { $in: itemIds },
    status:      'pending',
  };
  if (reportedUserId) query.reportedUser = reportedUserId;

  const reports = await Report.find(query)
    .select('relatedItem _id')
    .lean();

  // map: itemId → reportId (نأخذ أحدث بلاغ إن وُجد أكثر من واحد)
  const reportMap = {};
  reports.forEach(r => {
    const key = r.relatedItem.toString();
    // ✅ نحتفظ بأول بلاغ فقط (مرتّب بـ MongoDB default = insert order)
    if (!reportMap[key]) reportMap[key] = r._id.toString();
  });

  return items.map(item => ({
    ...item,
    reportId: reportMap[item._id.toString()] ?? null,
  }));
}

// ─── تبرعاتي كمتبرع ──────────────────────────────────────────
exports.findDonationsByUser = async (userId) => {
  const items = await Item.find({ donor: userId })
    .populate('bookedBy', 'name avatar trustScore isVerifiedStudent')
    .populate('safeHub',  'name city')
    .sort({ createdAt: -1 })
    .lean();

  // ✅ بدون reportedUserId — البلاغ على الغرض بغض النظر عن المُبلَّغ عنه
  return attachReportIds(items, null);
};

// ─── طلبات الاستلام ───────────────────────────────────────────
exports.findReceivedByUser = async (userId) => {
  const items = await Item.find({ bookedBy: userId })
    .populate('donor',   'name avatar trustScore isVerifiedStudent')
    .populate('safeHub', 'name address city workingHours')
    .sort({ createdAt: -1 })
    .lean();

  // ✅ userId كـ filter — البلاغ على المستلم تحديداً
  return attachReportIds(items, userId);
};