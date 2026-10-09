import Rating from '../models/Rating.js';
import mongoose from 'mongoose';
import Item from '../models/Item.js';
import User from '../models/User.js';
import type {
  EntityId,
  RepositoryPayload,
  RepositorySession,
} from './repositoryTypes.js';

type ExistingRatingQuery = { itemId: EntityId; raterId: EntityId };

export const findItemById = (
  itemId: EntityId,
  session: RepositorySession = null
) =>
  Item.findById(itemId)
    .select('donor bookedBy status title isRated')
    .session(session);

export const findExistingRating = (
  { itemId, raterId }: ExistingRatingQuery,
  session: RepositorySession = null
) => Rating.findOne({ item: itemId, rater: raterId }).session(session);

export const createRating = async (
  payload: RepositoryPayload,
  session: RepositorySession = null
) => {
  if (!session) return Rating.create(payload);
  const [rating] = await Rating.create([payload], { session });
  return rating;
};

export const markItemRated = (
  itemId: EntityId,
  session: RepositorySession = null
) => Item.findByIdAndUpdate(
  itemId,
  { isRated: true },
  { returnDocument: 'after', session: session ?? undefined }
);

export const incrementUserTrustScore = (
  userId: EntityId,
  trustDelta: number,
  session: RepositorySession = null
) =>
  User.findByIdAndUpdate(
    userId,
    { $inc: { trustScore: trustDelta } },
    { returnDocument: 'after', session: session ?? undefined }
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

export const findNextPendingRating = async (userId: EntityId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [pending] = await Item.aggregate([
    { $match: {
      status: 'تم التسليم',
      $or: [{ donor: id }, { bookedBy: id }],
      donor: { $ne: null }, bookedBy: { $ne: null },
      $expr: { $ne: ['$donor', '$bookedBy'] },
    } },
    { $sort: { deliveredAt: 1, _id: 1 } },
    { $lookup: {
      from: Rating.collection.name, let: { itemId: '$_id' },
      pipeline: [
        { $match: { rater: id, $expr: { $eq: ['$item', '$$itemId'] } } },
        { $limit: 1 }, { $project: { _id: 1 } },
      ], as: 'ownRating',
    } },
    { $match: { 'ownRating.0': { $exists: false } } },
    { $limit: 1 },
    { $project: { _id: 1, title: 1, status: 1, donor: 1, bookedBy: 1, imageUrl: 1 } },
  ]).option({ maxTimeMS: 2_000 });
  if (!pending) return null;
  return Item.populate(pending, [
    { path: 'donor', select: 'name avatar' },
    { path: 'bookedBy', select: 'name avatar' },
  ]);
};

export default { findNextPendingRating, findItemById, findExistingRating, createRating, markItemRated, incrementUserTrustScore, findRatingsForUser, findDeliveredItemsAsDonor, findDeliveredItemsAsReceiver, findRatedItemIdsByRater };
