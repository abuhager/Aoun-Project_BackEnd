import Rating from '../models/Rating.js';
import Item from '../models/Item.js';
import User from '../models/User.js';
import type { EntityId, RepositoryPayload } from './repositoryTypes.js';

type ExistingRatingQuery = { itemId: EntityId; raterId: EntityId };

export const findItemById = (itemId: EntityId) =>
  Item.findById(itemId)
    .select('donor bookedBy status title isRated');

export const findExistingRating = ({ itemId, raterId }: ExistingRatingQuery) =>
  Rating.findOne({ item: itemId, rater: raterId });

export const createRating = (payload: RepositoryPayload) =>
  Rating.create(payload);

export const markItemRated = (itemId: EntityId) =>
  Item.findByIdAndUpdate(itemId, { isRated: true }, { new: true });

export const incrementUserTrustScore = (userId: EntityId, trustDelta: number) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: trustDelta } },
    { new: true }
  );

export const findRatingsForUser = (userId: EntityId) =>
  Rating.find({ ratee: userId })
    .select('score comment createdAt item rater')
    .populate('item', 'title')
    .populate('rater', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(20);

export const findDeliveredItemsAsDonor = (userId: EntityId) =>
  Item.find({ donor: userId, status: 'تم التسليم' })
    .populate('bookedBy', 'name avatar')
    .lean();

export const findDeliveredItemsAsReceiver = (userId: EntityId) =>
  Item.find({ bookedBy: userId, status: 'تم التسليم' })
    .populate('donor', 'name avatar')
    .lean();

export const findRatedItemIdsByRater = async (userId: EntityId) =>
  Rating.find({ rater: userId }).distinct('item');

export default { findItemById, findExistingRating, createRating, markItemRated, incrementUserTrustScore, findRatingsForUser, findDeliveredItemsAsDonor, findDeliveredItemsAsReceiver, findRatedItemIdsByRater };
