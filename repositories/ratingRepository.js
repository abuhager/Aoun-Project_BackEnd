// repositories/ratingRepository.js
const Rating = require('../models/Rating');
const Item   = require('../models/Item');
const User   = require('../models/User');

const withSession = (query, session) => (
  session ? query.session(session) : query
);

// اختيار الحقول المطلوبة فقط للأداء وعدم جلب بيانات ضخمة
exports.findItemById = (itemId, session = null) =>
  withSession(
    Item.findById(itemId).select('donor bookedBy status title isRated'),
    session
  );

exports.findExistingRating = ({ itemId, raterId }, session = null) =>
  withSession(Rating.findOne({ item: itemId, rater: raterId }), session);

exports.createRating = async (payload, session = null) => {
  if (!session) return Rating.create(payload);
  const [rating] = await Rating.create([payload], { session });
  return rating;
};

exports.markItemRated = (itemId, session = null) =>
  Item.findByIdAndUpdate(
    itemId,
    { isRated: true },
    { new: true, runValidators: true, ...(session ? { session } : {}) }
  );

exports.incrementUserTrustScore = (userId, trustDelta, session = null) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: trustDelta } },
    { new: true, runValidators: true, ...(session ? { session } : {}) }
  );

exports.findRatingsForUser = (userId) =>
  Rating.find({ ratee: userId })
    .select('score comment createdAt item rater')
    .populate('item', 'title')
    .populate('rater', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(20);

exports.findDeliveredItemsAsDonor = (userId) =>
  Item.find({ donor: userId, status: 'تم التسليم' })
    .populate('bookedBy', 'name avatar')
    .lean();

exports.findDeliveredItemsAsReceiver = (userId) =>
  Item.find({ bookedBy: userId, status: 'تم التسليم' })
    .populate('donor', 'name avatar')
    .lean();

exports.findRatedItemIdsByRater = async (userId) =>
  Rating.find({ rater: userId }).distinct('item');
