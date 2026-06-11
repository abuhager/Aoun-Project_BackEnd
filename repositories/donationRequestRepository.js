// repositories/donationRequestRepository.js
const DonationRequest = require('../models/DonationRequest');

// ✅ تعريف واحد فقط — كان مُعرَّفاً مرتين في الملف الأصلي
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
    .populate({                        // ✅ أضف هاد
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

// ✅ إصلاح: { returnDocument: 'after' } مُهمَل منذ Mongoose 8 — الصواب { returnDocument: 'after' }
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

    // جلب طلب نشط واحد بالـ ID مع populate للـ requester
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
      select: 'condition status safeHub donor recipientConfirmed donorConfirmed', // ← أضف donorConfirmed
      populate: [
        { path: 'safeHub', select: 'name city address' },
        { path: 'donor',   select: 'name' },
      ],
    })
    .lean();

    // جلب طلب واحد كامل بـ ID مع populate
exports.findRequestById = (requestId) =>
  DonationRequest.findById(requestId)
    .populate('requester', 'name avatar trustLevel trustScore')
    .lean();