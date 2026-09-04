const mongoose = require('mongoose');

const Item = require('../models/Item');
const Rating = require('../models/Rating');
import type { EntityId, RepositoryFilter } from './repositoryTypes';

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

exports.findOwnDonations = (userId: EntityId, skip: number, limit: number) =>
  findActivity({ donor: userId }, 'createdAt', skip, limit);

exports.findReceivedItems = (userId: EntityId, skip: number, limit: number) =>
  findActivity(
    { bookedBy: userId, status: 'تم التسليم' },
    'deliveredAt',
    skip,
    limit
  );

exports.countOwnDonations = (userId: EntityId) => Item.countDocuments({ donor: userId });

exports.countReceivedItems = (userId: EntityId) =>
  Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' });

exports.findPublicDonations = (userId: EntityId, skip: number, limit: number) =>
  findActivity(
    { donor: userId, status: 'تم التسليم', linkedRequestId: null },
    'deliveredAt',
    skip,
    limit
  );

exports.findPublicReceivedItems = (userId: EntityId, skip: number, limit: number) =>
  findActivity(
    { bookedBy: userId, status: 'تم التسليم', linkedRequestId: null },
    'deliveredAt',
    skip,
    limit
  );

exports.countPublicDonations = (userId: EntityId) =>
  Item.countDocuments({ donor: userId, status: 'تم التسليم', linkedRequestId: null });

exports.countPublicReceivedItems = (userId: EntityId) =>
  Item.countDocuments({ bookedBy: userId, status: 'تم التسليم', linkedRequestId: null });

exports.getRatingSummary = async (userId: EntityId) => {
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
