const mongoose = require('mongoose');

const Item = require('../models/Item');
const Rating = require('../models/Rating');

const ACTIVITY_FIELDS = '_id title category status imageUrl createdAt deliveredAt';

const findActivity = (filter, dateField, skip, limit) =>
  Item.find(filter)
    .sort({ [dateField]: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .select(ACTIVITY_FIELDS)
    .lean();

exports.findOwnDonations = (userId, skip, limit) =>
  findActivity({ donor: userId }, 'createdAt', skip, limit);

exports.findReceivedItems = (userId, skip, limit) =>
  findActivity(
    { bookedBy: userId, status: 'تم التسليم' },
    'deliveredAt',
    skip,
    limit
  );

exports.countOwnDonations = (userId) => Item.countDocuments({ donor: userId });

exports.countReceivedItems = (userId) =>
  Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' });

exports.findPublicDonations = (userId, skip, limit) =>
  findActivity(
    { donor: userId, status: 'تم التسليم' },
    'deliveredAt',
    skip,
    limit
  );

exports.findPublicReceivedItems = (userId, skip, limit) =>
  findActivity(
    { bookedBy: userId, status: 'تم التسليم' },
    'deliveredAt',
    skip,
    limit
  );

exports.countPublicDonations = (userId) =>
  Item.countDocuments({ donor: userId, status: 'تم التسليم' });

exports.countPublicReceivedItems = (userId) =>
  Item.countDocuments({ bookedBy: userId, status: 'تم التسليم' });

exports.getRatingSummary = async (userId) => {
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
