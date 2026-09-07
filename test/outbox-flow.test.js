const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';

const OutboxEvent = require('../models/OutboxEvent').default;
const outboxRepository = require('../repositories/outboxRepository').default;
const emailService = require('../services/emailService').default;
const outboxWorker = require('../jobs/outboxWorker').default;
const {
  encryptOutboxPayload,
  decryptOutboxPayload,
} = require('../utils/outboxCrypto');

test('محتوى Outbox السري مشفر ومحمٍ من العبث', () => {
  const payload = {
    to: 'private@example.test',
    otp: '843921',
  };
  const encrypted = encryptOutboxPayload(payload);

  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, /private@example\.test|843921/);
  assert.deepEqual(decryptOutboxPayload(encrypted), payload);
  assert.throws(
    () => decryptOutboxPayload(`${encrypted.slice(0, -1)}x`),
    /OUTBOX_PAYLOAD_DECRYPT_FAILED/
  );
});

test('Outbox يملك فهرس idempotency وفهارس claim وTTL', () => {
  const indexes = OutboxEvent.schema.indexes();
  const byName = (name) => indexes.find(([, options]) => options.name === name);

  assert.equal(byName('idempotency_key_unique')[1].unique, true);
  assert.deepEqual(byName('outbox_claim_order')[0], {
    status: 1,
    availableAt: 1,
    createdAt: 1,
  });
  assert.equal(byName('completed_outbox_ttl')[1].expireAfterSeconds, 30 * 24 * 60 * 60);
});

test('عامل Outbox يؤكد النجاح ويعيد جدولة الفشل دون تسريب المحتوى', async (t) => {
  const originals = {
    claimNext: outboxRepository.claimNext,
    complete: outboxRepository.complete,
    fail: outboxRepository.fail,
    sendVerificationEmail: emailService.sendVerificationEmail,
  };
  t.after(() => Object.assign(outboxRepository, originals));
  t.after(() => {
    emailService.sendVerificationEmail = originals.sendVerificationEmail;
  });

  const encryptedPayload = encryptOutboxPayload({
    to: 'member@example.test',
    otp: '123456',
    name: 'Member',
    isStudent: false,
    expiryMinutes: 10,
  });
  let claims = 0;
  let completed = 0;
  let failed = 0;
  outboxRepository.claimNext = async () => {
    claims += 1;
    return claims === 1
      ? {
          _id: 'event-1',
          type: 'verification_email',
          encryptedPayload,
          attempts: 1,
          maxAttempts: 5,
        }
      : null;
  };
  outboxRepository.complete = async () => { completed += 1; };
  outboxRepository.fail = async () => { failed += 1; };
  emailService.sendVerificationEmail = async () => {};

  assert.equal(await outboxWorker.processOutboxBatch(), 1);
  assert.equal(completed, 1);
  assert.equal(failed, 0);

  claims = 0;
  completed = 0;
  emailService.sendVerificationEmail = async () => {
    throw Object.assign(new Error('secret-provider-body'), { code: 'ETIMEDOUT' });
  };
  const logCalls = [];
  t.mock.method(console, 'error', (...args) => logCalls.push(args));

  assert.equal(await outboxWorker.processOutboxBatch(), 0);
  assert.equal(completed, 0);
  assert.equal(failed, 1);
  assert.doesNotMatch(JSON.stringify(logCalls), /secret-provider-body|member@example\.test|123456/);
});

test('تدفقات التفعيل والاستعادة تحفظ الحالة وOutbox داخل transaction', () => {
  const authSource = fs.readFileSync(
    path.join(__dirname, '../services/authService.ts'),
    'utf8'
  );
  const notifySource = fs.readFileSync(
    path.join(__dirname, '../utils/notifyUser.ts'),
    'utf8'
  );

  assert.match(authSource, /runMongoTransaction[\s\S]*enqueueVerificationEmail/);
  assert.match(authSource, /forgotPasswordLogic[\s\S]*runMongoTransaction[\s\S]*enqueuePasswordResetEmail/);
  assert.match(notifySource, /runMongoTransaction[\s\S]*enqueueCriticalNotificationEmail/);
});
