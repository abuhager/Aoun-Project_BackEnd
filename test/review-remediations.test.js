const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const Item = require('../models/Item').default;
const SafeHub = require('../models/SafeHub').default;
const Conversation = require('../models/Conversation').default;
const { OUTBOX_EVENT_TYPES } = require('../models/OutboxEvent');
const { getBusinessMonthKey, BUSINESS_TIME_ZONE } = require('../utils/businessTime');
const { deriveTrustLevel, phoneVerificationPromotesTrust } = require('../utils/trustPolicy');
const {
  normalizeSearchText,
  buildSearchPrefixes,
  buildSearchTokens,
} = require('../utils/searchText');
const { SOCKET_EVENTS } = require('../socket/contracts');
const {
  encodeMessageCursor,
  decodeMessageCursor,
} = require('../repositories/conversationRepository');
const {
  consumeSocketMessageQuota,
  resetSocketRateLimitsForTests,
} = require('../utils/socketRateLimit');

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');

test('الشهر المحاسبي يتبع Asia/Amman عند حد منتصف الليل لا UTC', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'Asia/Amman');
  assert.equal(getBusinessMonthKey('2026-08-31T20:59:59.000Z'), '2026-08');
  assert.equal(getBusinessMonthKey('2026-08-31T21:00:00.000Z'), '2026-09');
});

test('ملكية الهاتف دليل مستقل ولا ترفع tier افتراضياً', () => {
  const phoneOnly = {
    emailVerified: true,
    studentVerified: false,
    phoneVerified: true,
    adminApproved: false,
  };
  assert.equal(phoneVerificationPromotesTrust({}), false);
  assert.equal(deriveTrustLevel(phoneOnly), 1);
  assert.equal(deriveTrustLevel(phoneOnly, { phonePromotesTrust: true }), 2);
  assert.equal(deriveTrustLevel({ ...phoneOnly, studentVerified: true }), 2);
});

test('حذف الغرض يحفظ tombstone ويرحّل حذف الصورة إلى Outbox', () => {
  assert.ok(Item.schema.path('status').enumValues.includes('محذوف'));
  assert.ok(Item.schema.path('deletedAt'));
  assert.ok(Conversation.schema.path('archivedAt'));
  assert.ok(OUTBOX_EVENT_TYPES.includes('cloudinary_delete'));

  const service = read('../services/itemService.ts');
  assert.match(service, /status: 'محذوف'/);
  assert.match(service, /enqueueCloudinaryDelete/);
  assert.doesNotMatch(
    service.slice(service.indexOf('export const deleteItemLogic')),
    /findOneAndDelete/
  );
});

test('تعطيل Safe Hub يملك حالة انتقالية وكل كتابة مرجعية تحجز السجل', () => {
  assert.deepEqual(SafeHub.schema.path('lifecycleState').enumValues, [
    'active',
    'deactivating',
    'inactive',
  ]);
  const repository = read('../repositories/hubRepository.ts');
  const itemService = read('../services/itemService.ts');
  const requestService = read('../services/donationRequestService.ts');
  assert.match(repository, /beginDeactivation/);
  assert.match(repository, /operationVersion/);
  assert.match(itemService, /acquireActiveForWrite/);
  assert.match(requestService, /acquireActiveForWrite/);
});

test('قراءات طلبات التبرع تعرض الحالة الفعالة ولا تشغّل أمر الانتهاء', () => {
  const source = read('../services/donationRequestService.ts');
  const start = source.indexOf('export const getRequestByIdLogic');
  const end = source.indexOf('export const expireDonationRequestsLogic', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /expireSingleRequest/);
  assert.match(source.slice(start, end), /toEffectivePublicRequest/);
});

test('البحث العربي موحد وله حقل مفهرس وbackfill آمن', () => {
  assert.equal(normalizeSearchText('  إِلكترونيّات، جامعيّة  '), 'الكترونيات جامعيه');
  assert.deepEqual(buildSearchTokens('كتاب كتاب', 'جامعي'), ['كتاب', 'جامعي']);
  assert.deepEqual(buildSearchPrefixes('شاشة'), ['شا', 'شاش', 'شاشه']);
  assert.ok(Item.schema.indexes().some(([keys]) => keys.searchTokens === 1));
  assert.ok(Item.schema.indexes().some(([keys]) => keys.searchPrefixes === 1));
  assert.match(read('../scripts/backfill-item-search.ts'), /dry-run/);
});

test('صفحات رسائل المحادثة تستخدم مؤشراً ثابتاً مع createdAt و_id', () => {
  const cursor = encodeMessageCursor({
    _id: '507f1f77bcf86cd799439011',
    createdAt: new Date('2026-09-07T12:34:56.000Z'),
  });
  const decoded = decodeMessageCursor(cursor);
  assert.equal(decoded.createdAt.toISOString(), '2026-09-07T12:34:56.000Z');
  assert.equal(decoded.id.toString(), '507f1f77bcf86cd799439011');
  assert.equal(decodeMessageCursor('not-a-cursor'), null);
  assert.ok(Item.db.model('Message').schema.indexes().some(([keys]) => (
    keys.conversation === 1 && keys.createdAt === -1 && keys._id === -1
  )));
});

test('التشغيل الموزع يربط Socket وcache وcron عبر Redis', () => {
  assert.match(read('../socket/redisAdapter.ts'), /createAdapter/);
  assert.match(read('../utils/runtimeBus.ts'), /session:invalidate|publishRuntimeEvent/);
  assert.match(read('../jobs/cronJobs.ts'), /runWithDistributedLock/);
  assert.match(read('../socket/index.ts'), /transports: \['websocket'\]/);
  assert.match(read('../utils/socketRateLimit.ts'), /redis\.eval/);
});

test('حد رسائل Socket يتبع المستخدم ولا يُصفّر مع اتصال جديد', async (t) => {
  const previousTopology = process.env.RUNTIME_TOPOLOGY;
  process.env.RUNTIME_TOPOLOGY = 'single';
  resetSocketRateLimitsForTests();
  t.after(() => {
    resetSocketRateLimitsForTests();
    if (previousTopology === undefined) delete process.env.RUNTIME_TOPOLOGY;
    else process.env.RUNTIME_TOPOLOGY = previousTopology;
  });

  const timestamp = Date.parse('2026-09-07T12:00:00.000Z');
  for (let attempt = 0; attempt < 15; attempt += 1) {
    assert.equal(
      (await consumeSocketMessageQuota('507f1f77bcf86cd799439011', timestamp)).allowed,
      true
    );
  }
  assert.equal(
    (await consumeSocketMessageQuota('507f1f77bcf86cd799439011', timestamp)).allowed,
    false
  );
});

test('عقد Socket القابل للقراءة الآلية يطابق ثوابت الخادم', () => {
  const contract = JSON.parse(read('../contracts/aoun-socket.v1.json'));
  const contractEvents = new Set([
    ...Object.values(contract.clientToServer),
    ...Object.values(contract.serverToClient),
  ]);
  assert.deepEqual(contractEvents, new Set(Object.values(SOCKET_EVENTS)));
});
