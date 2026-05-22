// backend/repositories/itemRepository.js
const Item = require('../models/Item');

// ==========================================
// 1. دوال الحجز والإضافة
// ==========================================
exports.findItemById = async (itemId) => {
    return await Item.findById(itemId);
};

exports.bookItemSafely = async (itemId, userId, updateData) => {
  return await Item.findOneAndUpdate(
    { 
      _id: itemId,
      status: 'متاح',
      donor: { $ne: userId },
      cancelledBy: { $nin: [userId] }
    },
    updateData,
    { returnDocument: 'after' } // ✅
  );
};

exports.addToWaitlist = async (itemId, userId) => {
  return await Item.findByIdAndUpdate(
    itemId,
    { $addToSet: { waitlist: { user: userId, joinedAt: new Date() } } },
    { returnDocument: 'after' } // ✅
  );
};

exports.createItem = async (itemData) => {
    const newItem = new Item(itemData);
    return await newItem.save();
};

// ==========================================
// 2. دوال العرض وتقسيم الصفحات (Pagination)
// ==========================================
exports.findItemsWithPagination = async (query, skip, limit) => {
    return await Item.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
};

exports.countItems = async (query) => {
    return await Item.countDocuments(query);
};

// ==========================================
// 3. دوال البروفايل والأغراض الشخصية
// ==========================================
exports.findDonationsByUser = async (userId) => {
  return await Item.find({ donor: userId })
    .populate('bookedBy', 'name avatar trustScore email phone isVerifiedStudent')
    .sort({ createdAt: -1 })
    .lean();
};

exports.findRequestsByUser = async (userId) => {
  return await Item.find({ bookedBy: userId })
    .populate('donor', 'name avatar trustScore email phone isVerifiedStudent')
    .sort({ createdAt: -1 })
    .lean();
};

exports.findItemDetails = async (itemId) => {
    return await Item.findById(itemId)
        .populate('donor', 'name phone trustScore avatar isVerified isVerifiedStudent')
        .select('+cancelledBy +deliveryOtp +bookedAt');
};

exports.findItemForAction = async (itemId) => {
    return await Item.findById(itemId).select('+cancelledBy +deliveryOtp');
};

exports.findItemForUpdate = async (itemId, donorId) => {
    return await Item.findOne({ _id: itemId, donor: donorId });
};

exports.deleteItemById = async (itemDoc) => {
    return await itemDoc.deleteOne();
};

exports.findPendingRating = async (userId) => {
  return await Item.findOne({
    bookedBy: userId,
    status: 'تم التسليم',
    isRated: false,
  }).select('_id title');
};