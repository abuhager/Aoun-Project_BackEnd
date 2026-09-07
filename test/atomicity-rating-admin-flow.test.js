const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://aoun.example';
process.env.JWT_SECRET = 'atomicity-access-secret-that-is-long-enough';
process.env.JWT_REFRESH_SECRET = 'atomicity-refresh-secret-that-is-long-enough';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'atomicity-test-cloud';
process.env.CLOUDINARY_API_KEY = 'atomicity-test-key';
process.env.CLOUDINARY_API_SECRET = 'atomicity-test-secret';

const ratingRepository = require('../repositories/ratingRepository').default;
const adminRepository = require('../repositories/adminRepository').default;
const userRepository = require('../repositories/userRepository').default;
const ratingService = require('../services/ratingService').default;
const adminService = require('../services/adminService').default;
const SystemSettings = require('../models/SystemSettings').default;
const Notification = require('../models/Notification').default;
const Item = require('../models/Item').default;

const ITEM_ID = '507f1f77bcf86cd799439011';
const RATER_ID = '507f1f77bcf86cd799439012';
const RATEE_ID = '507f1f77bcf86cd799439013';
const ADMIN_ID = '507f1f77bcf86cd799439014';

const createSessionHarness = (events) => {
  const session = {
    async withTransaction(work) {
      events.push('transaction:start');
      try {
        await work();
        events.push('transaction:commit');
      } catch (error) {
        events.push('transaction:abort');
        throw error;
      }
    },
    async endSession() { events.push('session:end'); },
  };
  return session;
};

test('التقييم يحدّث السجل والغرض والثقة في جلسة واحدة ثم يرسل الإشعار بعد commit', async (t) => {
  const events = [];
  const session = createSessionHarness(events);
  const originals = {
    startSession: mongoose.startSession,
    settings: SystemSettings.getCached,
    findItem: ratingRepository.findItemById,
    findExisting: ratingRepository.findExistingRating,
    create: ratingRepository.createRating,
    markRated: ratingRepository.markItemRated,
    incrementTrust: ratingRepository.incrementUserTrustScore,
    notification: Notification.create,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    SystemSettings.getCached = originals.settings;
    ratingRepository.findItemById = originals.findItem;
    ratingRepository.findExistingRating = originals.findExisting;
    ratingRepository.createRating = originals.create;
    ratingRepository.markItemRated = originals.markRated;
    ratingRepository.incrementUserTrustScore = originals.incrementTrust;
    Notification.create = originals.notification;
  });

  mongoose.startSession = async () => session;
  SystemSettings.getCached = async () => ({ ratingThresholdExcellent: 9 });
  ratingRepository.findItemById = async (_itemId, receivedSession) => {
    assert.equal(receivedSession, session);
    return {
      _id: ITEM_ID,
      donor: RATER_ID,
      bookedBy: RATEE_ID,
      status: 'تم التسليم',
      title: 'كتاب',
    };
  };
  ratingRepository.findExistingRating = async (_query, receivedSession) => {
    assert.equal(receivedSession, session);
    return null;
  };
  ratingRepository.createRating = async (payload, receivedSession) => {
    assert.equal(receivedSession, session);
    events.push('rating:create');
    return { _id: ITEM_ID, ...payload };
  };
  ratingRepository.markItemRated = async (_itemId, receivedSession) => {
    assert.equal(receivedSession, session);
    events.push('item:mark-rated');
  };
  ratingRepository.incrementUserTrustScore = async (_userId, _delta, receivedSession) => {
    assert.equal(receivedSession, session);
    events.push('user:trust');
  };
  Notification.create = async (payload) => {
    events.push('notification:create');
    return { _id: ITEM_ID, ...payload, createdAt: new Date(), isRead: false };
  };

  await ratingService.submitRating({
    itemId: ITEM_ID,
    raterId: RATER_ID,
    score: 9,
    comment: 'ممتاز',
  });

  assert.deepEqual(events, [
    'transaction:start',
    'rating:create',
    'item:mark-rated',
    'user:trust',
    'transaction:commit',
    'session:end',
    'notification:create',
  ]);
});

test('فشل تحديث الثقة يُجهض معاملة التقييم ولا يرسل إشعاراً', async (t) => {
  const events = [];
  const session = createSessionHarness(events);
  const originals = {
    startSession: mongoose.startSession,
    settings: SystemSettings.getCached,
    findItem: ratingRepository.findItemById,
    findExisting: ratingRepository.findExistingRating,
    create: ratingRepository.createRating,
    markRated: ratingRepository.markItemRated,
    incrementTrust: ratingRepository.incrementUserTrustScore,
    notification: Notification.create,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    SystemSettings.getCached = originals.settings;
    ratingRepository.findItemById = originals.findItem;
    ratingRepository.findExistingRating = originals.findExisting;
    ratingRepository.createRating = originals.create;
    ratingRepository.markItemRated = originals.markRated;
    ratingRepository.incrementUserTrustScore = originals.incrementTrust;
    Notification.create = originals.notification;
  });

  let notifications = 0;
  mongoose.startSession = async () => session;
  SystemSettings.getCached = async () => ({});
  ratingRepository.findItemById = async () => ({
    _id: ITEM_ID,
    donor: RATER_ID,
    bookedBy: RATEE_ID,
    status: 'تم التسليم',
    title: 'كتاب',
  });
  ratingRepository.findExistingRating = async () => null;
  ratingRepository.createRating = async (payload) => ({ _id: ITEM_ID, ...payload });
  ratingRepository.markItemRated = async () => undefined;
  ratingRepository.incrementUserTrustScore = async () => {
    throw new Error('trust write failed');
  };
  Notification.create = async () => { notifications += 1; };

  await assert.rejects(
    ratingService.submitRating({ itemId: ITEM_ID, raterId: RATER_ID, score: 8 }),
    /trust write failed/
  );
  assert.equal(notifications, 0);
  assert.deepEqual(events, ['transaction:start', 'transaction:abort', 'session:end']);
});

test('إعادة نفس Payload للتقييم تُعامل كإعادة idempotent بلا مضاعفة للثقة', async (t) => {
  const events = [];
  const session = createSessionHarness(events);
  const existingRating = {
    _id: '507f1f77bcf86cd799439099',
    item: ITEM_ID,
    rater: RATER_ID,
    ratee: RATEE_ID,
    score: 9,
    comment: 'ممتاز',
  };
  const originals = {
    startSession: mongoose.startSession,
    settings: SystemSettings.getCached,
    findItem: ratingRepository.findItemById,
    findExisting: ratingRepository.findExistingRating,
    create: ratingRepository.createRating,
    markRated: ratingRepository.markItemRated,
    incrementTrust: ratingRepository.incrementUserTrustScore,
    notification: Notification.create,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    SystemSettings.getCached = originals.settings;
    ratingRepository.findItemById = originals.findItem;
    ratingRepository.findExistingRating = originals.findExisting;
    ratingRepository.createRating = originals.create;
    ratingRepository.markItemRated = originals.markRated;
    ratingRepository.incrementUserTrustScore = originals.incrementTrust;
    Notification.create = originals.notification;
  });

  mongoose.startSession = async () => session;
  SystemSettings.getCached = async () => ({});
  ratingRepository.findItemById = async () => ({
    _id: ITEM_ID,
    donor: RATER_ID,
    bookedBy: RATEE_ID,
    status: 'تم التسليم',
    title: 'كتاب',
  });
  ratingRepository.findExistingRating = async () => existingRating;
  ratingRepository.createRating = async () => assert.fail('يجب ألا ينشئ تقييماً ثانياً');
  ratingRepository.markItemRated = async () => assert.fail('يجب ألا يكرر تحديث الغرض');
  ratingRepository.incrementUserTrustScore = async () => assert.fail('يجب ألا يضاعف الثقة');
  Notification.create = async () => assert.fail('يجب ألا يكرر الإشعار');

  const result = await ratingService.submitRating({
    itemId: ITEM_ID,
    raterId: RATER_ID,
    score: 9,
    comment: 'ممتاز',
  });

  assert.equal(result, existingRating);
  assert.deepEqual(events, [
    'transaction:start',
    'transaction:commit',
    'session:end',
  ]);
});

test('فشل سجل الحظر يُجهض المعاملة ولا يرسل آثاراً خارجية', async (t) => {
  const events = [];
  const session = createSessionHarness(events);
  const originals = {
    startSession: mongoose.startSession,
    findUser: userRepository.findByIdForAdmin,
    ban: adminRepository.banUser,
    invalidateSession: userRepository.invalidateUserSession,
    updateMany: Item.updateMany,
    log: adminRepository.logAdminAction,
    notification: Notification.create,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    userRepository.findByIdForAdmin = originals.findUser;
    adminRepository.banUser = originals.ban;
    userRepository.invalidateUserSession = originals.invalidateSession;
    Item.updateMany = originals.updateMany;
    adminRepository.logAdminAction = originals.log;
    Notification.create = originals.notification;
  });

  let notifications = 0;
  mongoose.startSession = async () => session;
  userRepository.findByIdForAdmin = async (_id, receivedSession) => {
    assert.equal(receivedSession, session);
    return { _id: RATEE_ID, name: 'مستخدم', email: null, role: 'user' };
  };
  adminRepository.banUser = async (_id, _reason, _adminId, receivedSession) => {
    assert.equal(receivedSession, session);
    return { _id: RATEE_ID, name: 'مستخدم', role: 'user', isBanned: true };
  };
  userRepository.invalidateUserSession = async (_id, receivedSession) => {
    assert.equal(receivedSession, session);
  };
  Item.updateMany = async (_filter, _update, options) => {
    assert.equal(options.session, session);
  };
  adminRepository.logAdminAction = async (_payload, receivedSession) => {
    assert.equal(receivedSession, session);
    throw new Error('audit write failed');
  };
  Notification.create = async () => { notifications += 1; };

  await assert.rejects(
    adminService.banUser(RATEE_ID, ADMIN_ID, 'super_admin', 'سبب', 'ملاحظة'),
    /audit write failed/
  );
  assert.equal(notifications, 0);
  assert.deepEqual(events, ['transaction:start', 'transaction:abort', 'session:end']);
});
