const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const DonationRequest = require('../models/DonationRequest').default;
const {
  assertUniqueIndexCanBeCreated,
  getIndexGroups,
  indexCreateOptions,
  indexDefinitionsEquivalent,
} = require('../utils/ensureIndexes');

const findIndex = (groups, modelName, indexName) => groups
  .find(({ model }) => model.modelName === modelName)
  ?.indexes.find(({ name }) => name === indexName);

test('مهمة الإنتاج تغطي كل Models التي تملك فهارس تشغيلية', () => {
  const modelNames = getIndexGroups().map(({ model }) => model.modelName).sort();

  assert.deepEqual(modelNames, [
    'AdminLog',
    'Conversation',
    'DonationOffer',
    'DonationRequest',
    'Item',
    'Message',
    'Notification',
    'Rating',
    'Report',
    'SafeHub',
    'SystemSettings',
    'User',
  ]);
});

test('الفهارس الحرجة تأتي من الـschemas وتدخل manifest الإنتاج تلقائياً', () => {
  const groups = getIndexGroups();
  const criticalIndexes = [
    ['AdminLog', 'createdAt_desc'],
    ['DonationOffer', 'request_donor_unique'],
    ['Item', 'linked_request_unique'],
    ['Notification', 'user_1_isRead_1_createdAt_-1'],
    ['Rating', 'item_1_rater_1'],
    ['Report', 'pending_report_context_unique'],
    ['SafeHub', 'isActive_1_city_1'],
    ['User', 'email_1'],
  ];

  for (const [modelName, indexName] of criticalIndexes) {
    assert.ok(findIndex(groups, modelName, indexName), `${modelName}.${indexName}`);
  }

  assert.equal(findIndex(groups, 'DonationOffer', 'request_donor_unique').unique, true);
  assert.equal(findIndex(groups, 'Item', 'linked_request_unique').unique, true);
  assert.equal(findIndex(groups, 'Report', 'pending_report_context_unique').replaceIfDifferent, true);
});

test('طلبات التبرع لا تملك TTL يحذف السجل بعد انتهاء صلاحيته', () => {
  assert.equal(
    DonationRequest.schema.indexes().some(([, options]) => (
      options.expireAfterSeconds !== undefined
    )),
    false
  );
});

test('مقارنة الفهارس تلتقط اختلاف القيود لا اختلاف الاسم فقط', () => {
  const requested = {
    key: { email: 1 },
    name: 'email_1',
    unique: true,
    sparse: false,
  };

  assert.equal(indexDefinitionsEquivalent(requested, requested), true);
  assert.equal(indexDefinitionsEquivalent(
    { ...requested, unique: false },
    requested
  ), false);
});

test('خيارات إنشاء الفهرس لا ترسل قيماً فارغة يرفضها MongoDB', () => {
  const options = indexCreateOptions({
    key: { createdAt: -1 },
    name: 'createdAt_desc',
    unique: undefined,
    sparse: undefined,
    expireAfterSeconds: undefined,
    partialFilterExpression: undefined,
    collation: undefined,
    replaceIfDifferent: false,
  });

  assert.deepEqual(options, { name: 'createdAt_desc' });
  assert.equal(Object.values(options).includes(undefined), false);
  assert.equal(Object.values(options).includes(null), false);
});

test('فحص الفهرس الفريد يوقف الترحيل قبل الإنشاء عند وجود تكرار', async () => {
  const collection = {
    aggregate: () => ({ toArray: async () => [{ count: 2 }] }),
  };

  await assert.rejects(
    assertUniqueIndexCanBeCreated(collection, {
      key: { request: 1, donor: 1 },
      name: 'request_donor_unique',
      unique: true,
    }),
    (error) => (
      error.message.includes('request_donor_unique')
      && !error.message.includes('507f')
    )
  );
});
