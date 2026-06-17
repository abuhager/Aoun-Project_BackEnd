// repositories/donationRequestRepository.js ✅ PATCHED [LOGIC-02 | SEC-02]
const DonationRequest = require('../models/DonationRequest');
const DonationOffer   = require('../models/DonationOffer'); // ✅ SEC-02: كانت غائبة

// عدد الطلبات في الشهر (بغض النظر عن الحالة) — للحد الأقصى عند الإنشاء
exports.countAllMonthlyRequests = ({ userId, month }) =>
  DonationRequest.countDocuments({ requester: userId, month });

// ✅ LOGIC-02: كانت مستدعاة في getMyRequestsLogic لكنها غير موجودة → TypeError
// عدد الطلبات النشطة في الشهر — للعرض في صفحة "طلباتي"
exports.countActiveMonthlyRequests = ({ userId, month, now }) =>
  DonationRequest.countDocuments({
    requester: userId,
    month,
    status:    'active',
    expiresAt: { $gt: now },
  });

exports.createRequest = (payload) =>
  DonationRequest.create(payload);

exports.findRequests = ({ filter, skip, limit }) =>
  DonationRequest.find(filter)
    .populate('requester', 'name avatar trustLevel trustScore')
    .populate({
      path:   'fulfilledByItem',
      select: '_id condition status safeHub donor',
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

exports.countRequests = (filter) =>
  DonationRequest.countDocuments(filter);

exports.cancelOwnedActiveRequest = ({ requestId, userId }) =>
  DonationRequest.findOneAndUpdate(
    { _id: requestId, requester: userId, status: 'active' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );

exports.findUserRequests = (userId) =>
  DonationRequest.find({ requester: userId })
    .sort({ createdAt: -1 })
    .populate({
      path:   'fulfilledByItem',
      select: '_id condition status safeHub donor',
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .lean();

exports.findActiveRequestById = (requestId) =>
  DonationRequest.findOne({
    _id:       requestId,
    status:    'active',
    expiresAt: { $gt: new Date() },
  })
    .populate('requester', 'name email')
    .lean();

exports.findRequestByIdWithItem = (requestId) =>
  DonationRequest.findById(requestId)
    .populate('requester', 'name')
    .populate({
      path:   'fulfilledByItem',
      select: '_id condition status safeHub donor recipientConfirmed donorConfirmed',
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .lean();

exports.findRequestById = (requestId) =>
  DonationRequest.findById(requestId)
    .populate('requester', 'name avatar trustLevel trustScore')
    .lean();

// ✅ SEC-02: DonationOffer مُضافة بـ require في أعلى الملف
exports.countPendingOffersByDonor = (donorId) =>
  DonationOffer.countDocuments({ donor: donorId, status: 'pending' });