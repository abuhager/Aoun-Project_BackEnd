const DonationOffer = require('../models/DonationOffer');
import type {
  EntityId,
  RepositoryPayload,
  RepositorySession,
} from './repositoryTypes';

// العرض المعلّق ما زال قابلاً للاختيار، لذلك يمنع تعطيل مركزه حتى يُعالج.
exports.countPendingByHub = (hubId: EntityId) =>
  DonationOffer.countDocuments({ safeHub: hubId, status: 'pending' });

// إنشاء عرض جديد
exports.createOffer = async (
  payload: RepositoryPayload,
  session: RepositorySession = null
) => {
  if (!session) return DonationOffer.create(payload);
  const [offer] = await DonationOffer.create([payload], { session });
  return offer;
};

// هل قدّم هذا المتبرع عرضاً مسبقاً؟
// التعديل: استخدام !! للتأكد من إرجاع true/false صريحة توافقاً مع الـ Service
exports.existsByRequestAndDonor = async (requestId: EntityId, donorId: EntityId) => {
  const result = await DonationOffer.exists({ request: requestId, donor: donorId });
  return !!result;
};

exports.findViewerOffer = (requestId: EntityId, donorId: EntityId) =>
  DonationOffer.findOne({ request: requestId, donor: donorId })
    .select('_id status createdAt')
    .lean();

// جلب كل العروض على طلب معين (لصاحب الطلب فقط)
exports.findOffersByRequest = (requestId: EntityId) =>
  DonationOffer.find({ request: requestId })
    .populate('donor',   'name avatar trustLevel trustScore')
    .populate('safeHub', 'name city address')
    .sort({ createdAt: -1 })
    .lean();

// جلب عرض واحد بـ ID مع populate كامل
exports.findOfferById = (offerId: EntityId) =>
  DonationOffer.findById(offerId)
    .populate('donor',   'name avatar trustLevel trustScore')
    .populate('safeHub', 'name city address')
    .lean();

// تحديث حالة عروض متعددة دفعةً واحدة (داخل session)
exports.rejectAllPendingExcept = (
  requestId: EntityId,
  acceptedOfferId: EntityId,
  session: RepositorySession
) =>
  DonationOffer.updateMany(
    { request: requestId, _id: { $ne: acceptedOfferId }, status: 'pending' },
    { $set: { status: 'rejected' } },
    { session }
  );

// قبول عرض واحد (داخل session)
exports.acceptOffer = (offerId: EntityId, session: RepositorySession) =>
  DonationOffer.findByIdAndUpdate(
    offerId,
    { $set: { status: 'accepted' } },
    { returnDocument: 'after', session }
  ).populate('donor',   'name email')
   .populate('safeHub', 'name city address');

/**
 * 🔥 التعديل الحرج المطلوب: حساب العروض المعلقة للمتبرع لضمان عمل الـ Service بنجاح
 * أضفتها بالاسم الأصلي والـ Alias البديل عشان تنتهي مشكلة الـ TypeError نهائياً
 */
exports.countPendingOffersByDonor = async (donorId: EntityId) => {
  return DonationOffer.countDocuments({ donor: donorId, status: 'pending' });
};

exports.countPendingByDonor = exports.countPendingOffersByDonor;
