import mongoose from 'mongoose';
import Item from '../models/Item.js';
import Rating from '../models/Rating.js';
import type { EntityId, RepositoryFilter } from './repositoryTypes.js';

const ACTIVITY_FIELDS = '_id title category status imageUrl createdAt deliveredAt';

const findActivity = (
  filter: RepositoryFilter,
  dateField: 'createdAt' | 'deliveredAt',
  skip: number,
  limit: number
) =>
  Item.find(filter)
    .sort({ [dateField]: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .select(ACTIVITY_FIELDS)
    .lean();

export const findOwnDonations = (userId: EntityId, skip: number, limit: number) =>
  findActivity({ donor: userId }, 'createdAt', skip, limit);

export const findReceivedItems = (userId: EntityId, skip: number, limit: number) =>
  findActivity(
    { bookedBy: userId, status: 'تم التسليم' },
    'deliveredAt',
    skip,
    limit
  );

export const countOwnDonations = (userId: EntityId) => Item.countDocuments({ donor: userId });

export const countReceivedItems = (userId: EntityId) =>
  Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' });

export const findPublicDonations = (userId: EntityId, skip: number, limit: number) =>
  findActivity(
    { donor: userId, status: 'تم التسليم', linkedRequestId: null },
    'deliveredAt',
    skip,
    limit
  );

export const findPublicReceivedItems = (userId: EntityId, skip: number, limit: number) =>
  findActivity(
    { bookedBy: userId, status: 'تم التسليم', linkedRequestId: null },
    'deliveredAt',
    skip,
    limit
  );

export const countPublicDonations = (userId: EntityId) =>
  Item.countDocuments({ donor: userId, status: 'تم التسليم', linkedRequestId: null });

export const countPublicReceivedItems = (userId: EntityId) =>
  Item.countDocuments({ bookedBy: userId, status: 'تم التسليم', linkedRequestId: null });

export const getRatingSummary = async (userId: EntityId) => {
  const [summary] = await Rating.aggregate([
    { $match: { ratee: new mongoose.Types.ObjectId(String(userId)) } },
    {
      $group: {
        _id: null,
        totalRatings: { $sum: 1 },
        averageRating: { $avg: '$score' },
      },
    },
  ]);

  return {
    totalRatings: Number(summary?.totalRatings ?? 0),
    averageRating: Number((summary?.averageRating ?? 0).toFixed(1)),
  };
};

export default { findOwnDonations, findReceivedItems, countOwnDonations, countReceivedItems, findPublicDonations, findPublicReceivedItems, countPublicDonations, countPublicReceivedItems, getRatingSummary };
