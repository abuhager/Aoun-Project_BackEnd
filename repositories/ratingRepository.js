// repositories/ratingRepository.js
const Rating = require('../models/Rating');
const Item = require('../models/Item');
const User = require('../models/User');

exports.findItemById = (itemId) =>
  Item.findById(itemId);

exports.findExistingRating = ({ itemId, raterId }) =>
  Rating.findOne({ item: itemId, rater: raterId });

exports.createRating = (payload) =>
  Rating.create(payload);

exports.markItemRated = (itemId) =>
  Item.findByIdAndUpdate(itemId, { isRated: true }, { new: true });

exports.incrementUserTrustScore = (userId, trustDelta) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: trustDelta } },
    { new: true }
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