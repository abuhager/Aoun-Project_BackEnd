import Item from '../models/Item.js';
import Report from '../models/Report.js';
import type {
  DeletableDocument,
  EntityId,
  RepositoryRecord,
} from './repositoryTypes.js';

// ✅ ARCH-02: projection واحدة مُعرَّفة هنا فقط
const ITEM_DETAILS_PROJECTION = '-__v';

export const findItemDetails = (itemId: EntityId) =>
  Item.findById(itemId)
    .populate('donor',      'name avatar phone trustScore isVerifiedStudent trustLevel')
    .populate('safeHub',    'name address city workingHours coordinates') // تم إضافة coordinates
    .populate('bookedBy',   'name avatar phone email')
    .select(ITEM_DETAILS_PROJECTION);

export const findByIdLean = (itemId: EntityId) =>
  Item.findById(itemId).lean();

export const countActiveByDonor = (donorId: EntityId) =>
  Item.countDocuments({ donor: donorId, status: { $in: ['متاح', 'محجوز'] } });

export const countActiveByHub = (hubId: EntityId) =>
  Item.countDocuments({
    safeHub: hubId,
    status: { $in: ['متاح', 'محجوز'] },
  });

export const countActiveBookingsByUser = (userId: EntityId) =>
  Item.countDocuments({ bookedBy: userId, status: 'محجوز' });

export const findItemForAction = (itemId: EntityId) =>
  Item.findById(itemId)
    .populate('safeHub', 'name address city workingHours');

export const findItemForUpdate = (itemId: EntityId, userId: EntityId) =>
  Item.findOne({ _id: itemId, donor: userId })
    .populate('safeHub', 'name address city workingHours');

export const deleteItemById = (item: DeletableDocument) => item.deleteOne();

// ─── helper: يربط reportId بكل item ──────────────────────────
async function attachReportIds(
  items: RepositoryRecord[],
  reportedUserId: EntityId
) {
  if (!items.length) return items;

  const itemIds = items.map((item) => item._id);

  // نبحث بـ relatedItem فقط — نتجاهل البلاغات بدون غرض
  const query: Record<string, unknown> = {
    relatedItem: { $in: itemIds },
    status:      'pending',
  };
  if (reportedUserId) query.reportedUser = reportedUserId;

  const reports = await Report.find(query)
    .select('relatedItem _id')
    .sort({ createdAt: -1 })
    .lean();

  // map: itemId → reportId (نأخذ أحدث بلاغ إن وُجد أكثر من واحد)
  const reportMap: Record<string, string> = {};
  reports.forEach((report: RepositoryRecord) => {
    const key = String(report.relatedItem);
    // نحتفظ بأول بلاغ فقط (مرتّب بـ MongoDB default = insert order)
    if (!reportMap[key]) reportMap[key] = String(report._id);
  });

  return items.map((item) => ({
    ...item,
    reportId: reportMap[String(item._id)] ?? null,
  }));
}

export const findDonationsByUser = async (userId: EntityId) => {
  const items = await Item.find({ donor: userId })
    .populate('bookedBy', 'name avatar phone email trustScore isVerifiedStudent')
    .populate('safeHub',  'name city')
    .sort({ createdAt: -1 })
    .lean() as RepositoryRecord[];

  // لا نعرض زر الاعتراض إلا إذا كان صاحب لوحة التحكم هو المُبلَّغ عنه.
  return attachReportIds(items, userId);
};

export const findReceivedByUser = async (userId: EntityId) => {
  const items = await Item.find({ bookedBy: userId })
    .populate('donor',   'name avatar phone trustScore isVerifiedStudent')
    .populate('safeHub', 'name address city workingHours')
    .sort({ createdAt: -1 })
    .lean() as RepositoryRecord[];

  // userId كـ filter — البلاغ على المستلم تحديداً
  return attachReportIds(items, userId);
};

export default { findItemDetails, findByIdLean, countActiveByDonor, countActiveByHub, countActiveBookingsByUser, findItemForAction, findItemForUpdate, deleteItemById, findDonationsByUser, findReceivedByUser };
