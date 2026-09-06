const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'contracts-test-access-secret-123456789';
process.env.JWT_REFRESH_SECRET = 'contracts-test-refresh-secret-12345678';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'contracts-cloud';
process.env.CLOUDINARY_API_KEY = 'contracts-key';
process.env.CLOUDINARY_API_SECRET = 'contracts-secret';

const validateBody = require('../middlewares/validateBody').default;
const validateObjectId = require('../middlewares/validateObjectId').default;
const authDto = require('../dtos/authDto').default;
const adminDto = require('../dtos/adminDto').default;
const ratingDto = require('../dtos/ratingDto').default;

const USER_ID = '507f1f77bcf86cd799439011';

const runBodyValidation = (schemaName, body) => new Promise((resolve) => {
  const req = { body, id: 'request-contract-1', headers: {} };
  const response = { statusCode: 200, payload: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(payload) { response.payload = payload; resolve({ req, response }); },
  };
  validateBody(schemaName)(req, res, () => resolve({ req, response }));
});

test('عقد المستخدم المصادق لا يسمح بتسريب أسرار الهوية أو الجلسة', () => {
  const result = authDto.toAuthUser({
    _id: USER_ID,
    name: 'Contract User',
    email: 'contract@example.com',
    role: 'user',
    password: 'must-not-leak',
    verificationOtp: 'must-not-leak',
    refreshToken: 'must-not-leak',
    trustScore: 70,
    trustLevel: 1,
    quota: 2,
    totalDonations: 0,
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  });

  assert.equal(result._id, USER_ID);
  assert.equal(result.createdAt, '2026-08-24T10:00:00.000Z');
  assert.equal(result.isBanned, false);
  assert.equal(result.isFrozen, false);
  assert.equal('password' in result, false);
  assert.equal('verificationOtp' in result, false);
  assert.equal('refreshToken' in result, false);
});

test('عقود الإدارة تعرض الحقول المحددة فقط وتستخدم imageUrl المفرد', () => {
  const user = adminDto.toAdminUser({
    _id: USER_ID,
    name: 'Admin Target',
    email: 'target@example.com',
    role: 'user',
    trustLevel: 2,
    trustScore: 88,
    password: 'must-not-leak',
  });
  const item = adminDto.toAdminItem({
    _id: USER_ID,
    title: 'كتاب',
    category: 'كتب',
    status: 'متاح',
    imageUrl: 'https://cdn.example/item.webp',
    cloudinaryId: 'must-not-leak',
    donor: { _id: USER_ID, name: 'Donor', email: 'donor@example.com' },
  });

  assert.equal('password' in user, false);
  assert.equal(item.imageUrl, 'https://cdn.example/item.webp');
  assert.equal('images' in item, false);
  assert.equal('cloudinaryId' in item, false);
});

test('عقد التقييم المعلّق لا يعيد سجل الغرض الخام', () => {
  const response = ratingDto.toPendingRatingResponse({
    _id: USER_ID,
    title: 'حاسوب',
    status: 'تم التسليم',
    isRated: false,
    donor: { _id: USER_ID, name: 'Donor', avatar: '' },
    bookedBy: { _id: '507f1f77bcf86cd799439012', name: 'Receiver' },
    waitlist: [{ user: 'private' }],
    cancelledBy: ['private'],
    cloudinaryId: 'private',
  });

  assert.deepEqual(Object.keys(response.pendingRating).sort(), [
    '_id', 'bookedBy', 'donor', 'isRated', 'status', 'title',
  ]);
  assert.equal('waitlist' in response.pendingRating, false);
  assert.equal('cloudinaryId' in response.pendingRating, false);
});

test('عقود إجراءات الإدارة تفرض سبب الحظر وملاحظة حذف الغرض', async () => {
  const missingBanReason = await runBodyValidation('banUser', {});
  assert.equal(missingBanReason.response.statusCode, 422);
  assert.equal(missingBanReason.response.payload.code, 'VALIDATION_ERROR');
  assert.equal(missingBanReason.response.payload.requestId, 'request-contract-1');

  const validBan = await runBodyValidation('banUser', {
    reason: '  مخالفة واضحة  ',
    adminNote: '  ملاحظة داخلية  ',
  });
  assert.equal(validBan.response.statusCode, 200);
  assert.equal(validBan.req.body.reason, 'مخالفة واضحة');

  const missingDeleteNote = await runBodyValidation('deleteItemAdmin', {});
  assert.equal(missingDeleteNote.response.statusCode, 422);

  const validUnban = await runBodyValidation('unbanUser', {});
  assert.equal(validUnban.response.statusCode, 200);
});

test('خطأ ObjectId يتبع غلاف الخطأ الموحد', () => {
  const req = {
    params: { id: 'not-an-object-id' },
    id: 'request-contract-2',
    headers: {},
  };
  let payload;
  let statusCode;
  validateObjectId('id')(
    req,
    {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; },
    },
    () => assert.fail('المعرف غير الصالح يجب ألا يمر')
  );

  assert.equal(statusCode, 400);
  assert.equal(payload.code, 'INVALID_ID');
  assert.equal(payload.status, 'fail');
  assert.equal(payload.requestId, 'request-contract-2');
});

test('المسارات تستخدم مصدر التحقق المركزي لكل إجراءات الإدارة', () => {
  const routes = fs.readFileSync(
    path.join(__dirname, '../routes/admin.ts'),
    'utf8'
  );
  assert.match(routes, /demote[\s\S]*validateBody\('promoteUser'\)/);
  assert.match(routes, /unban[\s\S]*validateBody\('unbanUser'\)/);
  assert.match(routes, /items\/:id[\s\S]*validateBody\('deleteItemAdmin'\)/);
});
