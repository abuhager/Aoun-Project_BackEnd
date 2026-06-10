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
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

exports.countRequests = (filter) =>
  DonationRequest.countDocuments(filter);

// ✅ إصلاح: { new: true } مُهمَل منذ Mongoose 8 — الصواب { returnDocument: 'after' }
exports.cancelOwnedActiveRequest = ({ requestId, userId }) =>
  DonationRequest.findOneAndUpdate(
    { _id: requestId, requester: userId, status: 'active' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );

exports.findUserRequests = (userId) =>
  DonationRequest.find({ requester: userId })
    .sort({ createdAt: -1 })
    .lean();
