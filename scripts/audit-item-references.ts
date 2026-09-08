import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Item from '../models/Item.js';
import Conversation from '../models/Conversation.js';
import Rating from '../models/Rating.js';
import Report from '../models/Report.js';
import DonationRequest from '../models/DonationRequest.js';

const countOrphans = async (
  model: mongoose.Model<unknown>,
  field: string
): Promise<number> => {
  const rows = await model.aggregate([
    { $match: { [field]: { $type: 'objectId' } } },
    {
      $lookup: {
        from: Item.collection.name,
        localField: field,
        foreignField: '_id',
        as: '_referencedItem',
      },
    },
    { $match: { '_referencedItem.0': { $exists: false } } },
    { $count: 'count' },
  ]);
  return Number(rows[0]?.count ?? 0);
};

const run = async () => {
  await connectDB();
  const [conversations, ratings, reports, fulfilledRequests] = await Promise.all([
    countOrphans(Conversation, 'item'),
    countOrphans(Rating, 'item'),
    countOrphans(Report, 'relatedItem'),
    countOrphans(DonationRequest, 'fulfilledByItem'),
  ]);

  const report = {
    checkedAt: new Date().toISOString(),
    conversations,
    ratings,
    reports,
    fulfilledRequests,
    total: conversations + ratings + reports + fulfilledRequests,
  };
  console.log(JSON.stringify(report));
  if (report.total > 0) process.exitCode = 2;
};

run()
  .catch((error) => {
    console.error('[ItemReferenceAudit] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
