// repositories/ratingRepository.js
const Rating = require('../models/Rating');
const Item   = require('../models/Item');
const User   = require('../models/User');
import type { EntityId, RepositoryPayload } from './repositoryTypes';

type ExistingRatingQuery = { itemId: EntityId; raterId: EntityId };

// اختيار الحقول المطلوبة فقط للأداء وعدم جلب بيانات ضخمة
exports.findItemById = (itemId: EntityId) =>
  Item.findById(itemId)
    .select('donor bookedBy status title isRated');

exports.findExistingRating = ({ itemId, raterId }: ExistingRatingQuery) =>
  Rating.findOne({ item: itemId, rater: raterId });

exports.createRating = (payload: RepositoryPayload) =>
  Rating.create(payload);

exports.markItemRated = (itemId: EntityId) =>
  Item.findByIdAndUpdate(itemId, { isRated: true }, { new: true });

exports.incrementUserTrustScore = (userId: EntityId, trustDelta: number) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: trustDelta } },
    { new: true }
  );

exports.findRatingsForUser = (userId: EntityId) =>
  Rating.find({ ratee: userId })
    .select('score comment createdAt item rater')
    .populate('item', 'title')
    .populate('rater', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(20);

exports.findDeliveredItemsAsDonor = (userId: EntityId) =>
  Item.find({ donor: userId, status: 'تم التسليم' })
    .populate('bookedBy', 'name avatar')
    .lean();

exports.findDeliveredItemsAsReceiver = (userId: EntityId) =>
  Item.find({ bookedBy: userId, status: 'تم التسليم' })
    .populate('donor', 'name avatar')
    .lean();

exports.findRatedItemIdsByRater = async (userId: EntityId) =>
  Rating.find({ rater: userId }).distinct('item');
