const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlSessionCache } = require('../utils/sessionCache');
const { assessJobHealth } = require('../utils/jobHealth');
const { deriveTrustLevel } = require('../utils/trustPolicy');
const Outbox = require('../models/OutboxEvent').default;
const outboxRepo = require('../repositories/outboxRepository').default;

const now = Date.parse('2026-10-09T12:00:00Z');
const healthy = { scheduled: true, lastStatus: 'success', lastSuccessAt: new Date(now), nextRunAt: new Date(now + 3600000), consecutiveFailures: 0 };

test('الثقة الإدارية تتقدم على إثبات الطالب والهاتف دون حذف الأدلة', () => {
  const evidence = { studentVerified: true, phoneVerified: true, emailVerified: true, adminApproved: true };
  assert.equal(deriveTrustLevel(evidence, { adminOverride: 1, phonePromotesTrust: true }), 1);
  assert.equal(deriveTrustLevel(evidence, { adminOverride: 2 }), 2);
  assert.equal(deriveTrustLevel(evidence), 2);
  assert.equal(evidence.studentVerified, true);
});

test('كاش الجلسات محدود بحجم ثابت وTTL لا يتجدد عند القراءة', () => {
  let clock = 0;
  const cache = new TtlSessionCache(100, 2, () => clock);
  cache.set('first', 1); cache.set('second', 2);
  clock = 50;
  assert.equal(cache.get('first'), 1);
  cache.set('third', 3);
  assert.equal(cache.get('second'), undefined);
  for (let i = 0; i < 10000; i++) cache.set(String(i), i);
  assert.equal(cache.stats().size, 2);
  clock = 150; cache.prune();
  assert.equal(cache.stats().size, 0);
  cache.set('fixed', 42); clock = 200;
  assert.equal(cache.get('fixed'), 42);
  clock = 250; assert.equal(cache.get('fixed'), undefined);
});

test('مؤشر الأعمال يكشف فشل المهام والغياب بينما يراعي الجدولة الشهرية', () => {
  assert.equal(assessJobHealth('expire-old-bookings', healthy, now).healthy, true);
  assert.equal(assessJobHealth('expire-old-bookings', { ...healthy, lastStatus: 'failed', consecutiveFailures: 1 }, now).reason, 'LAST_RUN_FAILED');
  assert.equal(assessJobHealth('expire-old-bookings', { ...healthy, lastStatus: 'failed', consecutiveFailures: 2 }, now).reason, 'REPEATED_FAILURES');
  const old = { ...healthy, lastSuccessAt: new Date(now - 86400000) };
  assert.equal(assessJobHealth('quota-reset', old, now).healthy, true);
  assert.equal(assessJobHealth('expire-old-bookings', old, now).reason, 'SUCCESS_STALE');
  assert.equal(assessJobHealth('booking-reminder', { ...healthy, lastStatus: 'pending', lastSuccessAt: null, nextRunAt: new Date(now - 1800000) }, now).reason, 'SCHEDULE_MISSED');
  assert.equal(assessJobHealth('booking-reminder', { ...healthy, lastStatus: 'running', lastRun: new Date(now - 3600000) }, now).reason, 'RUN_OVERDUE');
});

test('استعادة Outbox لا تقتل القفل الساري وتوثق احتمال التسليم المجهول', async t => {
  let captured;
  t.mock.method(Outbox, 'updateMany', async (filter, update) => { captured = { filter, update }; return { modifiedCount: 1 }; });
  const cutoff = new Date(now - 120000);
  assert.equal((await outboxRepo.recoverExhausted(cutoff)).modifiedCount, 1);
  assert.deepEqual(captured.filter.$expr, { $gte: ['$attempts', '$maxAttempts'] });
  assert.deepEqual(captured.filter.$or[0], { status: 'processing', lockedAt: { $lte: cutoff } });
  assert.equal(captured.update.$set.status, 'dead');
  assert.equal(captured.update.$set.lastErrorCode, 'OUTBOX_EXHAUSTED_DELIVERY_UNKNOWN');
});
