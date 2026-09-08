const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createClient } = require('redis');

const runMongoTransaction = require('../utils/mongoTransaction').default;
const conversationRepository = require('../repositories/conversationRepository').default;
const { connectRedis, closeRedis } = require('../middlewares/rateLimiter');
const { consumeSocketMessageQuota } = require('../utils/socketRateLimit');

const enabled = process.env.RUN_RUNTIME_INTEGRATION === 'true';
const PROBE_COLLECTION = 'runtime_atomicity_probe';
const PROBE_EMAIL = 'runtime-index-probe@aoun.invalid';

test('Mongo replica set يثبت rollback والفهارس وcursor بينما Redis يجيب PING', {
  skip: !enabled,
  timeout: 30_000,
}, async (t) => {
  const mongoUri = process.env.MONGO_URI;
  const redisUrl = process.env.REDIS_URL;
  assert.ok(mongoUri, 'MONGO_URI مطلوب لاختبار التكامل');
  assert.ok(redisUrl, 'REDIS_URL مطلوب لاختبار التكامل');

  const redis = createClient({ url: redisUrl });
  t.after(async () => {
    await closeRedis();
    if (redis.isOpen) await redis.quit();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.collection('users').deleteMany({ runtimeProbe: true });
      await mongoose.connection.collection('messages').deleteMany({ runtimeProbe: true });
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

  const users = mongoose.connection.collection('users');
  const firstUserId = new mongoose.Types.ObjectId();
  await users.insertOne({
    _id: firstUserId,
    runtimeProbe: true,
    name: 'Runtime index probe',
    email: PROBE_EMAIL,
    password: 'not-a-real-hash',
    phone: '+962790000001',
    phoneVerified: false,
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await assert.rejects(
    users.insertOne({
      _id: new mongoose.Types.ObjectId(),
      runtimeProbe: true,
      name: 'Duplicate runtime index probe',
      email: PROBE_EMAIL,
      password: 'not-a-real-hash',
      phone: '+962790000002',
      phoneVerified: false,
      isVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    (error) => error?.code === 11000
  );

  const conversationId = new mongoose.Types.ObjectId();
  const messages = mongoose.connection.collection('messages');
  const baseTime = Date.parse('2026-09-07T12:00:00.000Z');
  await messages.insertMany([1, 2, 3, 4].map((sequence) => ({
    _id: new mongoose.Types.ObjectId(),
    runtimeProbe: true,
    conversation: conversationId,
    sender: firstUserId,
    text: `message-${sequence}`,
    read: false,
    createdAt: new Date(baseTime + sequence * 1_000),
    updatedAt: new Date(baseTime + sequence * 1_000),
  })));

  const firstPage = await conversationRepository.findMessagesPage(conversationId, {
    cursor: null,
    limit: 2,
  });
  assert.deepEqual(firstPage.messages.map((message) => message.text), [
    'message-3',
    'message-4',
  ]);
  assert.equal(firstPage.hasMore, true);
  assert.ok(firstPage.nextCursor);

  await messages.insertOne({
    _id: new mongoose.Types.ObjectId(),
    runtimeProbe: true,
    conversation: conversationId,
    sender: firstUserId,
    text: 'message-arrived-between-pages',
    read: false,
    createdAt: new Date(baseTime + 10_000),
    updatedAt: new Date(baseTime + 10_000),
  });

  const secondPage = await conversationRepository.findMessagesPage(conversationId, {
    cursor: firstPage.nextCursor,
    limit: 2,
  });
  assert.deepEqual(secondPage.messages.map((message) => message.text), [
    'message-1',
    'message-2',
  ]);
  assert.equal(secondPage.hasMore, false);

  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');

  process.env.RUNTIME_TOPOLOGY = 'distributed';
  await connectRedis();
  const rateUserId = new mongoose.Types.ObjectId().toString();
  const rateTimestamp = Date.parse('2026-09-07T12:00:00.000Z');
  for (let attempt = 0; attempt < 15; attempt += 1) {
    assert.equal(
      (await consumeSocketMessageQuota(rateUserId, rateTimestamp)).allowed,
      true
    );
  }
  assert.equal(
    (await consumeSocketMessageQuota(rateUserId, rateTimestamp)).allowed,
    false
  );
  await redis.del(
    `socket-rate:message:${Math.floor(rateTimestamp / 10_000)}:${rateUserId}`
  );
});
