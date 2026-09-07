const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'concurrency-access-secret-that-is-long-enough';
process.env.JWT_REFRESH_SECRET = 'concurrency-refresh-secret-that-is-long-enough';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const itemService = require('../services/itemService').default;
const donationRequestService = require('../services/donationRequestService').default;
const donationRequestRepository = require('../repositories/donationRequestRepository').default;
const donationOfferRepository = require('../repositories/donationOfferRepository').default;
const Item = require('../models/Item').default;
const User = require('../models/User').default;
const DonationRequest = require('../models/DonationRequest').default;
const Notification = require('../models/Notification').default;
const SystemSettings = require('../models/SystemSettings').default;
const socket = require('../socket').default;
const runMongoTransaction = require('../utils/mongoTransaction').default;
const acquireUserOperationLocks = require('../utils/userOperationLock').default;

const USER_ID = '507f1f77bcf86cd799439011';
const OWNER_ID = '507f1f77bcf86cd799439012';
const REQUEST_ID_1 = '507f1f77bcf86cd799439013';
const REQUEST_ID_2 = '507f1f77bcf86cd799439014';
const ITEM_ID_1 = '507f1f77bcf86cd799439015';
const ITEM_ID_2 = '507f1f77bcf86cd799439016';

const queryReturning = (value) => ({
  select() { return this; },
  session() { return this; },
  lean() { return Promise.resolve(value); },
});

// يحاكي قفل كتابة MongoDB على مستند المستخدم: العملية الثانية تنتظر انتهاء الأولى.
const createUserLockHarness = () => {
  let tail = Promise.resolve();

  return {
    startSession: async () => {
      const session = {
        releaseLock: null,
        async withTransaction(work) {
          try {
            await work();
          } finally {
            session.releaseLock?.();
          }
        },
        async endSession() {},
      };
      return session;
    },
    updateUser: async (_filter, _update, { session }) => {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      session.releaseLock = release;
      return { matchedCount: 1 };
    },
  };
};

test('مساعد transaction يسمح بإعادة callback وينهي الجلسة مرة واحدة', async (t) => {
  const originalStartSession = mongoose.startSession;
  t.after(() => { mongoose.startSession = originalStartSession; });

  let callbackRuns = 0;
  let endCalls = 0;
  mongoose.startSession = async () => ({
    async withTransaction(work) {
      await work();
      await work();
    },
    async endSession() { endCalls += 1; },
  });

  const result = await runMongoTransaction(async () => {
    callbackRuns += 1;
    return callbackRuns;
  });

  assert.equal(result, 2);
  assert.equal(callbackRuns, 2);
  assert.equal(endCalls, 1);
});

test('قفل المستخدم يرتب المعرفات ويمنع تكرار القفل داخل العملية', async (t) => {
  const originalUpdateOne = User.updateOne;
  t.after(() => { User.updateOne = originalUpdateOne; });

  const calls = [];
  User.updateOne = async (filter, update, options) => {
    calls.push({ filter, update, options });
    return { matchedCount: 1 };
  };
  const session = {};

  await acquireUserOperationLocks([ITEM_ID_2, ITEM_ID_1, ITEM_ID_2], session);

  assert.deepEqual(calls.map(({ filter }) => filter._id), [ITEM_ID_1, ITEM_ID_2]);
  assert.deepEqual(calls[0].update, { $inc: { operationVersion: 1 } });
  assert.equal(calls[0].options.session, session);
  assert.equal(calls[0].options.timestamps, false);
});

test('طلبان شهريان متزامنان لنفس المستخدم لا يتجاوزان الحد', async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findUser: User.findById,
    updateUser: User.updateOne,
    settings: SystemSettings.getCached,
    count: donationRequestRepository.countAllMonthlyRequests,
    create: donationRequestRepository.createRequest,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findUser;
    User.updateOne = originals.updateUser;
    SystemSettings.getCached = originals.settings;
    donationRequestRepository.countAllMonthlyRequests = originals.count;
    donationRequestRepository.createRequest = originals.create;
  });

  const harness = createUserLockHarness();
  const requests = [];
  mongoose.startSession = harness.startSession;
  User.updateOne = harness.updateUser;
  User.findById = () => queryReturning({ isVerified: true, trustLevel: 2 });
  SystemSettings.getCached = async () => ({
    minTrustLevelForRequests: 2,
    maxActiveRequestsPerMonth: 1,
    requestExpiryDays: 30,
    categories: ['كتب'],
    locations: ['عمان'],
  });
  donationRequestRepository.countAllMonthlyRequests = async () => requests.length;
  donationRequestRepository.createRequest = async (payload) => {
    const request = { _id: REQUEST_ID_1, ...payload };
    requests.push(request);
    return request;
  };

  const input = {
    title: 'كتاب جامعي',
    description: 'نسخة صالحة للدراسة',
    category: 'كتب',
    location: 'عمان',
  };
  const results = await Promise.allSettled([
    donationRequestService.createRequestLogic(input, USER_ID),
    donationRequestService.createRequestLogic(input, USER_ID),
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(requests.length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'MONTHLY_LIMIT_EXCEEDED');
});

test('حجز غرضين متزامنين لنفس المستخدم يحترم الحد العالمي', async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findUser: User.findById,
    updateUser: User.updateOne,
    findItem: Item.findById,
    countItems: Item.countDocuments,
    updateItem: Item.findOneAndUpdate,
    settings: SystemSettings.getCached,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findUser;
    User.updateOne = originals.updateUser;
    Item.findById = originals.findItem;
    Item.countDocuments = originals.countItems;
    Item.findOneAndUpdate = originals.updateItem;
    SystemSettings.getCached = originals.settings;
  });

  const harness = createUserLockHarness();
  const bookedItems = new Set();
  mongoose.startSession = harness.startSession;
  User.updateOne = harness.updateUser;
  User.findById = () => queryReturning({ isVerified: true, trustLevel: 2, role: 'user' });
  SystemSettings.getCached = async () => ({ maxBookingsPerUser: 1 });
  Item.findById = (itemId) => queryReturning({
    _id: itemId,
    title: 'غرض',
    status: 'متاح',
    donor: OWNER_ID,
    bookedBy: null,
    waitlist: [],
    cancelledBy: [],
    linkedRequestId: null,
  });
  Item.countDocuments = async () => bookedItems.size;
  Item.findOneAndUpdate = (filter) => ({
    populate: async () => {
      bookedItems.add(filter._id.toString());
      return {
        _id: filter._id,
        title: 'غرض',
        status: 'محجوز',
        donor: { _id: OWNER_ID },
      };
    },
  });

  const results = await Promise.allSettled([
    itemService.bookItemLogic(ITEM_ID_1, USER_ID),
    itemService.bookItemLogic(ITEM_ID_2, USER_ID),
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(bookedItems.size, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'MAX_BOOKINGS_REACHED');
});

test('عرضان متزامنان لطلبين مختلفين لا يتجاوزان حد العروض المعلقة', async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findUser: User.findById,
    updateUser: User.updateOne,
    settings: SystemSettings.getCached,
    findRequest: donationRequestRepository.findActiveRequestById,
    exists: donationOfferRepository.existsByRequestAndDonor,
    count: donationOfferRepository.countPendingOffersByDonor,
    create: donationOfferRepository.createOffer,
    touchRequest: DonationRequest.updateOne,
    createNotification: Notification.create,
    getIO: socket.getIO,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findUser;
    User.updateOne = originals.updateUser;
    SystemSettings.getCached = originals.settings;
    donationRequestRepository.findActiveRequestById = originals.findRequest;
    donationOfferRepository.existsByRequestAndDonor = originals.exists;
    donationOfferRepository.countPendingOffersByDonor = originals.count;
    donationOfferRepository.createOffer = originals.create;
    DonationRequest.updateOne = originals.touchRequest;
    Notification.create = originals.createNotification;
    socket.getIO = originals.getIO;
  });

  const harness = createUserLockHarness();
  const offers = [];
  mongoose.startSession = harness.startSession;
  User.updateOne = harness.updateUser;
  User.findById = () => queryReturning({
    _id: USER_ID,
    name: 'متبرع',
    isVerified: true,
    phoneVerified: true,
    trustLevel: 2,
  });
  SystemSettings.getCached = async () => ({
    minTrustLevelForDonating: 1,
    maxPendingOffersPerDonor: 1,
  });
  donationRequestRepository.findActiveRequestById = async (requestId) => ({
    _id: requestId,
    title: 'طلب',
    requester: { _id: OWNER_ID },
  });
  donationOfferRepository.existsByRequestAndDonor = async () => false;
  donationOfferRepository.countPendingOffersByDonor = async () => offers.length;
  donationOfferRepository.createOffer = async (payload) => {
    const offer = { _id: ITEM_ID_1, ...payload };
    offers.push(offer);
    return offer;
  };
  DonationRequest.updateOne = async () => ({ matchedCount: 1 });
  Notification.create = async (payload) => ({
    _id: ITEM_ID_2,
    ...payload,
    metadata: payload.metadata ?? {},
    isRead: false,
    createdAt: new Date(),
  });
  socket.getIO = () => ({ to: () => ({ emit: () => {} }) });

  const input = { condition: 'مستعمل جيد', description: 'صالح للاستخدام' };
  const results = await Promise.allSettled([
    donationRequestService.submitOfferLogic(REQUEST_ID_1, USER_ID, input),
    donationRequestService.submitOfferLogic(REQUEST_ID_2, USER_ID, input),
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(offers.length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'MAX_PENDING_OFFERS_REACHED');
  await new Promise((resolve) => setImmediate(resolve));
});

test('كل مسارات إدخال الحصة تستخدم قفل المستخدم داخل transaction', () => {
  const itemSource = fs.readFileSync(path.join(__dirname, '../services/itemService.ts'), 'utf8');
  const requestSource = fs.readFileSync(
    path.join(__dirname, '../services/donationRequestService.ts'),
    'utf8'
  );
  const cronSource = fs.readFileSync(path.join(__dirname, '../jobs/cronJobs.ts'), 'utf8');

  assert.match(itemSource, /createItemLogic[\s\S]*runMongoTransaction[\s\S]*acquireUserOperationLocks/);
  assert.match(itemSource, /bookItemLogic[\s\S]*runMongoTransaction[\s\S]*acquireUserOperationLocks/);
  assert.match(requestSource, /createRequestLogic[\s\S]*runMongoTransaction[\s\S]*acquireUserOperationLocks/);
  assert.match(requestSource, /submitOfferLogic[\s\S]*runMongoTransaction[\s\S]*acquireUserOperationLocks/);
  assert.match(requestSource, /acceptOfferLogic[\s\S]*acquireUserOperationLocks/);
  assert.match(cronSource, /findEligibleWaitlistCandidate[\s\S]*acquireUserOperationLocks/);
  assert.equal(User.schema.path('operationVersion').options.select, false);
});
