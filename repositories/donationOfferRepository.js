// repositories/donationOfferRepository.js ✅ CLEAN & PATCHED
const DonationOffer = require('../models/DonationOffer');

// إنشاء عرض جديد
exports.createOffer = (payload) =>
  DonationOffer.create(payload);

// هل قدّم هذا المتبرع عرضاً مسبقاً؟
// التعديل: استخدام !! للتأكد من إرجاع true/false صريحة توافقاً مع الـ Service
exports.existsByRequestAndDonor = async (requestId, donorId) => {
  const result = await DonationOffer.exists({ request: requestId, donor: donorId });
  return !!result;
};

// جلب كل العروض على طلب معين (لصاحب الطلب فقط)
exports.findOffersByRequest = (requestId) =>
  DonationOffer.find({ request: requestId })
    .populate('donor',   'name avatar trustLevel trustScore')
    .populate('safeHub', 'name city address')
    .sort({ createdAt: -1 })
    .lean();

// جلب عرض واحد بـ ID مع populate كامل
exports.findOfferById = (offerId) =>
  DonationOffer.findById(offerId)
    .populate('donor',   'name avatar trustLevel trustScore')
    .populate('safeHub', 'name city address')
    .lean();

// تحديث حالة عروض متعددة دفعةً واحدة (داخل session)
exports.rejectAllPendingExcept = (requestId, acceptedOfferId, session) =>
  DonationOffer.updateMany(
    { request: requestId, _id: { $ne: acceptedOfferId }, status: 'pending' },
    { $set: { status: 'rejected' } },
    { session }
  );

// قبول عرض واحد (داخل session)
exports.acceptOffer = (offerId, session) =>
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
exports.countPendingOffersByDonor = async (donorId) => {
  return await DonationOffer.countDocuments({ donor: donorId, status: 'pending' });
};

exports.countPendingByDonor = exports.countPendingOffersByDonor;