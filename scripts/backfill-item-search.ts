import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Item from '../models/Item.js';
import { buildSearchPrefixes, buildSearchTokens } from '../utils/searchText.js';

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

const run = async () => {
  await connectDB();
  let scanned = 0;
  let mismatches = 0;
  let updated = 0;
  const operations: Parameters<typeof Item.bulkWrite>[0] = [];
  const cursor = Item.find({})
    .select('+searchTokens +searchPrefixes title description category location')
    .sort({ _id: 1 })
    .lean()
    .cursor();

  for await (const item of cursor) {
    scanned += 1;
    const expectedTokens = buildSearchTokens(
      item.title,
      item.description,
      item.category,
      item.location
    );
    const expectedPrefixes = buildSearchPrefixes(
      item.title,
      item.category,
      item.location
    );
    const tokensMatch = JSON.stringify(item.searchTokens ?? []) === JSON.stringify(expectedTokens);
    const prefixesMatch = JSON.stringify(item.searchPrefixes ?? []) === JSON.stringify(expectedPrefixes);
    if (tokensMatch && prefixesMatch) continue;
    mismatches += 1;
    if (!APPLY) continue;
    operations.push({
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            searchTokens: expectedTokens,
            searchPrefixes: expectedPrefixes,
          },
        },
      },
    });
    if (operations.length >= BATCH_SIZE) {
      const result = await Item.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount;
      operations.length = 0;
    }
  }

  if (operations.length) {
    const result = await Item.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount;
  }
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', scanned, mismatches, updated }));
};

run()
  .catch((error) => {
    console.error('[BackfillItemSearch] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
