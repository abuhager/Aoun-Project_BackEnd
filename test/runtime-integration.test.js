const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createClient } = require('redis');

const runMongoTransaction = require('../utils/mongoTransaction').default;

const enabled = process.env.RUN_RUNTIME_INTEGRATION === 'true';
const PROBE_COLLECTION = 'runtime_atomicity_probe';

test('Mongo replica set ينفذ rollback حقيقياً وRedis يجيب PING', {
  skip: !enabled,
  timeout: 30_000,
}, async (t) => {
  const mongoUri = process.env.MONGO_URI;
  const redisUrl = process.env.REDIS_URL;
  assert.ok(mongoUri, 'MONGO_URI مطلوب لاختبار التكامل');
  assert.ok(redisUrl, 'REDIS_URL مطلوب لاختبار التكامل');

  const redis = createClient({ url: redisUrl });
  t.after(async () => {
    if (redis.isOpen) await redis.quit();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropCollection(PROBE_COLLECTION).catch((error) => {
        if (error?.codeName !== 'NamespaceNotFound') throw error;
      });
      await mongoose.disconnect();
    }
  });

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5_000 });
  const collection = mongoose.connection.collection(PROBE_COLLECTION);
  await collection.deleteMany({});

  await assert.rejects(
    runMongoTransaction(async (session) => {
      await collection.insertOne({ probe: 'rollback' }, { session });
      throw new Error('intentional rollback probe');
    }),
    /intentional rollback probe/
  );
  assert.equal(await collection.countDocuments({}), 0);

  await runMongoTransaction(async (session) => {
    await collection.insertOne({ probe: 'commit' }, { session });
  });
  assert.equal(await collection.countDocuments({ probe: 'commit' }), 1);

  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');
});
