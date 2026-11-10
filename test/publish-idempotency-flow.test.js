const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const Item = require('../models/Item').default;

const source = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('donation publish key has a unique per-donor partial index', () => {
  const index = Item.schema.indexes().find(([, options]) => options.name === 'donor_publish_key_unique');
  assert.ok(index, 'missing publish uniqueness index');
  assert.deepEqual(index[0], { donor: 1, publishKey: 1 });
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { publishKey: { $type: 'string' } });
});

test('the publish API validates client keys and avoids changing the original input DTO', () => {
  const controller = source('controllers/itemController.ts');
  assert.match(controller, /req\.get\('Idempotency-Key'\)/);
  assert.match(controller, /INVALID_PUBLISH_KEY/);
  assert.match(controller, /createItemLogic\(req\.body as ItemInput, req\.user!\.id, req\.file!, rawPublishKey\)/);
});

test('same-key retry is checked before upload and under transactional user lock', () => {
  const service = source('services/itemService.ts');
  const createStart = service.indexOf('export const createItemLogic');
  const upload = service.indexOf('await uploadToCloudinary(file.buffer)', createStart);
  const fastRead = service.indexOf('findPublishedAttempt(userId, publishKey)', createStart);
  const lock = service.indexOf('await acquireUserOperationLocks([userId], session)', createStart);
  const lockedRead = service.indexOf("Item.findOne({ donor: userId, publishKey })", lock);
  const insert = service.indexOf('await Item.create', lock);
  assert.ok(createStart >= 0 && fastRead > createStart && upload > fastRead);
  assert.ok(lock > upload && lockedRead > lock && insert > lockedRead);
  assert.match(service, /assertMatchingPublishAttempt\(previous, payloadHash!\)/);
  assert.match(service, /if \(!replayed\) setImmediate/);
  assert.match(service, /await deleteFromCloudinary\(uploadResult\.public_id\)/);
});

test('CORS accepts publish header for the browser', () => {
  assert.match(source('app.ts'), /allowedHeaders: \[[^\n]*'Idempotency-Key'/);
});
