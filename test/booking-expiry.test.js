const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose').default;
process.env.NODE_ENV = 'test';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
const Item = require('../models/Item').default;
const User = require('../models/User').default;
const Notification = require('../models/Notification').default;
const Settings = require('../models/SystemSettings').default;
const { expireOldBookings, processExpiredItem, runBookingExpiryJob } = require('../jobs/cronJobs');
const { toAdminItem } = require('../dtos/adminDto');
const ITEM = '507f1f77bcf86cd799439011';
const BOOKER = '507f1f77bcf86cd799439012';
const DONOR = '507f1f77bcf86cd799439013';
const NEXT = '507f1f77bcf86cd799439014';
const bookedAt = new Date('2026-09-22T10:00:00Z');
const booking = { _id: ITEM, bookedBy: BOOKER, bookedAt, donor: DONOR, title: 'Laptop', waitlist: [] };
const query = value => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, session() { return this; }, lean: async () => value });
function transaction(t) {
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async work => work(), endSession: async () => {} }));
}

test('expiry query uses the configured duration and exact boundary; linked/confirmed bookings are excluded', async t => {
  const now = Date.parse('2026-10-08T10:00:00Z');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Settings, 'getCached', async () => ({ bookingExpiryHours: 48 }));
  t.mock.method(Item, 'find', filter => {
    assert.equal(filter.bookedAt.$lte.getTime(), now - 48 * 3600000);
    assert.deepEqual(filter.recipientConfirmed, { $ne: true });
    assert.equal(filter.linkedRequestId, null);
    assert.equal(filter.status, 'محجوز');
    const q = query([]);
    q.select = fields => { assert.match(fields, /bookedAt/); return q; };
    return q;
  });
  await expireOldBookings();
});

test('a renewed booking for the same user cannot be released by a stale expiry snapshot', async t => {
  transaction(t);
  const renewedAt = new Date('2026-10-08T10:00:00Z');
  const current = { ...booking, bookedAt: renewedAt, status: 'محجوز' };
  t.mock.method(Item, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.bookedAt, bookedAt);
    assert.equal(filter.bookedBy, BOOKER);
    if (filter.bookedAt.getTime() === current.bookedAt.getTime()) Object.assign(current, update.$set);
    return null;
  });
  t.mock.method(Notification, 'create', async () => { assert.fail('no notification for a stale transition'); });
  await processExpiredItem(booking, {});
  assert.equal(current.status, 'محجوز');
  assert.equal(current.bookedAt, renewedAt);
});

for (const promote of [false, true]) {
  test(`expired booking ${promote ? 'moves to the next eligible user' : 'returns to available'} atomically`, async t => {
    transaction(t);
    const notices = [];
    t.mock.method(Notification, 'create', async payload => { notices.push(payload); return { ...payload, _id: ITEM, createdAt: new Date() }; });
    t.mock.method(Settings, 'getCached', async () => ({ platformName: 'Aoun' }));
    t.mock.method(User, 'findOne', () => query({ _id: NEXT, name: 'Next user', email: '' }));
    t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1 }));
    t.mock.method(Item, 'countDocuments', async () => 0);
    t.mock.method(Item, 'findOneAndUpdate', async (filter, update) => {
      assert.equal(filter.bookedAt, bookedAt);
      assert.equal(filter.linkedRequestId, null);
      assert.deepEqual(filter.recipientConfirmed, { $ne: true });
      assert.equal(update.$set.status, promote ? 'محجوز' : 'متاح');
      assert.equal(update.$set.bookedBy, promote ? NEXT : null);
      assert.equal(update.$addToSet.cancelledBy, BOOKER);
      assert.equal(update.$set.recipientConfirmed, false);
      if (promote) {
        assert.ok(update.$set.bookedAt instanceof Date);
        assert.deepEqual(update.$pull.waitlist.user.$in, [NEXT]);
      } else assert.equal(update.$set.bookedAt, null);
      return { _id: ITEM };
    });
    await processExpiredItem({ ...booking, waitlist: promote ? [{ user: NEXT }] : [] }, { maxBookingsPerUser: 3 });
    assert.ok(notices.some(n => n.user === BOOKER && n.type === 'booking_cancelled'));
    assert.ok(notices.some(n => n.user === DONOR));
    assert.equal(notices.some(n => n.user === NEXT && n.type === 'waitlist_promoted'), promote);
  });
}

test('startup and scheduled expiry share one in-flight execution', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let queries = 0;
  t.mock.method(Settings, 'getCached', async () => { await pending; return { bookingExpiryHours: 72 }; });
  t.mock.method(Item, 'find', () => { queries++; return query([]); });
  const first = runBookingExpiryJob();
  const second = runBookingExpiryJob();
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(queries, 1);
});

test('admin exposes the configured deadline and explains recipient-confirmed bookings', () => {
  const raw = { ...booking, status: 'محجوز' };
  assert.equal(toAdminItem(raw, 48).bookingExpiresAt, '2026-09-24T10:00:00.000Z');
  assert.equal(toAdminItem({ ...raw, recipientConfirmed: true }, 48).bookingExpiresAt, null);
  assert.equal(toAdminItem({ ...raw, recipientConfirmed: true }, 48).recipientConfirmed, true);
  assert.equal(toAdminItem({ ...raw, linkedRequestId: ITEM }, 48).bookingExpiresAt, null);
  assert.equal(toAdminItem({ ...raw, status: 'متاح' }, 48).bookingExpiresAt, null);
});
