// repositories/donationOfferRepository.js
const DonationOffer = require('../models/DonationOffer');

// إنشاء عرض جديد
exports.createOffer = (payload) =>
  DonationOffer.create(payload);

// هل قدّم هذا المتبرع عرضاً مسبقاً؟
exports.existsByRequestAndDonor = (requestId, donorId) =>
  DonationOffer.exists({ request: requestId, donor: donorId });

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
    { session, returnDocument: 'after' }
  ).populate('donor',   'name email')
   .populate('safeHub', 'name city address');