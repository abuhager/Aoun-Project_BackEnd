import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import DonationRequest from '../models/DonationRequest.js';
import { BUSINESS_TIME_ZONE, getBusinessMonthKey } from '../utils/businessTime.js';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

const run = async () => {
  await connectDB();
  let scanned = 0;
  let mismatches = 0;
  let updated = 0;
  const operations: Parameters<typeof DonationRequest.bulkWrite>[0] = [];

  const cursor = DonationRequest.find({})
    .select('_id createdAt month')
    .sort({ _id: 1 })
    .lean()
    .cursor();

  for await (const request of cursor) {
    scanned += 1;
    const expected = getBusinessMonthKey(request.createdAt);
    if (request.month === expected) continue;
    mismatches += 1;
    if (!APPLY) continue;

    operations.push({
      updateOne: {
        filter: { _id: request._id, month: request.month },
        update: { $set: { month: expected } },
      },
    });

    if (operations.length >= BATCH_SIZE) {
      const result = await DonationRequest.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount;
      operations.length = 0;
    }
  }

  if (operations.length) {
    const result = await DonationRequest.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount;
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    timeZone: BUSINESS_TIME_ZONE,
    scanned,
    mismatches,
    updated,
  }));
};

run()
  .catch((error) => {
    console.error('[BackfillDonationRequestPeriod] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
