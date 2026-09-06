const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const validateBody = require('../middlewares/validateBody').default;
const hubDto = require('../dtos/hubDto').default;
const hubService = require('../services/hubService').default;
const hubRepository = require('../repositories/hubRepository').default;
const itemRepository = require('../repositories/itemRepository').default;
const donationOfferRepository = require('../repositories/donationOfferRepository').default;
const adminRepository = require('../repositories/adminRepository').default;
const SafeHub = require('../models/SafeHub').default;
const AdminLog = require('../models/AdminLog').default;

const HUB_ID = '507f1f77bcf86cd799439011';
const ADMIN_ID = '507f1f77bcf86cd799439012';

const runValidation = (schemaName, body) => new Promise((resolve) => {
  const req = { body };
  const response = { statusCode: 200, payload: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(payload) { response.payload = payload; resolve({ req, response }); },
  };
  validateBody(schemaName)(req, res, () => resolve({ req, response }));
});

const hubRecord = (overrides = {}) => ({
  _id: HUB_ID,
  name: 'مركز عمان',
  address: 'شارع الجامعة',
  city: 'عمان',
  coordinates: { lat: 31.95, lng: 35.91 },
  workingHours: '9:00 ص — 5:00 م',
  isActive: true,
  createdBy: ADMIN_ID,
  ...overrides,
});

test('عقد Hub يمنع تجاوز مسار التعطيل ويتحقق من الإحداثيات', async () => {
  const stateChange = await runValidation('updateHub', { isActive: false });
  assert.equal(stateChange.response.statusCode, 422);
  assert.equal(stateChange.response.payload.code, 'VALIDATION_ERROR');

  const partialCoordinates = await runValidation('createHub', {
    name: 'مركز عمان',
    address: 'شارع الجامعة',
    city: 'عمان',
    coordinates: { lat: 31.95 },
  });
  assert.equal(partialCoordinates.response.statusCode, 422);

  const invalidCoordinates = await runValidation('createHub', {
    name: 'مركز عمان',
    address: 'شارع الجامعة',
    city: 'عمان',
    coordinates: { lat: 91, lng: 181 },
  });
  assert.equal(invalidCoordinates.response.statusCode, 422);

  const valid = await runValidation('createHub', {
    name: '  مركز عمان  ',
    address: '  شارع الجامعة  ',
    city: '  عمان  ',
    coordinates: { lat: 0, lng: 0 },
  });
  assert.equal(valid.response.statusCode, 200);
  assert.equal(valid.req.body.name, 'مركز عمان');
  assert.deepEqual(valid.req.body.coordinates, { lat: 0, lng: 0 });

  const clearCoordinates = await runValidation('updateHub', { coordinates: null });
  assert.equal(clearCoordinates.response.statusCode, 200);
  assert.equal(clearCoordinates.req.body.coordinates, null);
});

test('المراكز القديمة غير المعطلة تبقى ظاهرة في القائمة العامة', async (t) => {
  const originalFind = SafeHub.find;
  let capturedFilter;
  t.after(() => { SafeHub.find = originalFind; });

  SafeHub.find = (filter) => {
    capturedFilter = filter;
    return {
      sort() { return this; },
      select() { return this; },
      lean() { return Promise.resolve([]); },
    };
  };

  await hubRepository.findAllActive();
  assert.deepEqual(capturedFilter, { isActive: { $ne: false } });
  assert.equal(hubDto.toPublicHub(hubRecord({ isActive: undefined })).isActive, true);
  assert.equal(hubDto.toPublicHub(hubRecord({ isActive: false })).isActive, false);
});

test('التعديل العام لا يستطيع تمرير isActive إلى MongoDB', async (t) => {
  const originalUpdate = SafeHub.findByIdAndUpdate;
  let capturedUpdate;
  t.after(() => { SafeHub.findByIdAndUpdate = originalUpdate; });

  SafeHub.findByIdAndUpdate = (_id, update) => {
    capturedUpdate = update;
    return Promise.resolve(hubRecord({ name: 'اسم جديد' }));
  };

  await hubRepository.updateById(HUB_ID, { name: 'اسم جديد', isActive: false });
  assert.deepEqual(capturedUpdate, { $set: { name: 'اسم جديد' } });
});

test('لا يعطل المركز مع أغراض نشطة أو عروض تبرع معلقة', async (t) => {
  const originals = {
    findById: hubRepository.findById,
    deactivate: hubRepository.deactivateById,
    activeItems: itemRepository.countActiveByHub,
    pendingOffers: donationOfferRepository.countPendingByHub,
  };
  t.after(() => {
    hubRepository.findById = originals.findById;
    hubRepository.deactivateById = originals.deactivate;
    itemRepository.countActiveByHub = originals.activeItems;
    donationOfferRepository.countPendingByHub = originals.pendingOffers;
  });

  hubRepository.findById = async () => hubRecord();
  itemRepository.countActiveByHub = async () => 2;
  donationOfferRepository.countPendingByHub = async () => 1;
  hubRepository.deactivateById = async () => {
    throw new Error('يجب ألا يصل التنفيذ إلى التعطيل');
  };

  const result = await hubService.deactivateHub(HUB_ID, ADMIN_ID);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'HUB_HAS_ACTIVE_HANDOFFS');
  assert.deepEqual(result.body.details, { activeItems: 2, pendingOffers: 1 });
});

test('كل عملية إدارة مركز تسجل هوية الأدمن والهدف', async (t) => {
  const originals = {
    create: hubRepository.create,
    log: adminRepository.logAdminAction,
  };
  t.after(() => {
    hubRepository.create = originals.create;
    adminRepository.logAdminAction = originals.log;
  });

  let auditEntry;
  hubRepository.create = async (payload) => hubRecord({ createdBy: payload.createdBy });
  adminRepository.logAdminAction = async (entry) => { auditEntry = entry; };

  const result = await hubService.createHub({
    name: 'مركز عمان',
    address: 'شارع الجامعة',
    city: 'عمان',
  }, ADMIN_ID);

  assert.equal(result.statusCode, 201);
  assert.equal(auditEntry.adminId, ADMIN_ID);
  assert.equal(auditEntry.action, 'HUB_MANAGE');
  assert.equal(auditEntry.targetModel, 'SafeHub');
  assert.equal(auditEntry.meta.operation, 'create');
});

test('إعادة التفعيل تستخدم المسار المخصص وتعيد hub داخل الغلاف المتفق عليه', async (t) => {
  const originals = {
    findById: hubRepository.findById,
    reactivate: hubRepository.reactivateById,
    log: adminRepository.logAdminAction,
  };
  t.after(() => {
    hubRepository.findById = originals.findById;
    hubRepository.reactivateById = originals.reactivate;
    adminRepository.logAdminAction = originals.log;
  });

  let auditEntry;
  hubRepository.findById = async () => hubRecord({ isActive: false });
  hubRepository.reactivateById = async () => hubRecord({ isActive: true });
  adminRepository.logAdminAction = async (entry) => { auditEntry = entry; };

  const result = await hubService.reactivateHub(HUB_ID, ADMIN_ID);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.hub.isActive, true);
  assert.equal(auditEntry.meta.operation, 'reactivate');
});

test('قيود Schema تطابق عقد API وسجل الأدمن يقبل SafeHub', () => {
  assert.equal(SafeHub.schema.path('name').options.maxlength, 100);
  assert.equal(SafeHub.schema.path('address').options.maxlength, 200);
  assert.equal(SafeHub.schema.path('coordinates.lat').options.min, -90);
  assert.equal(SafeHub.schema.path('coordinates.lng').options.max, 180);
  assert.ok(AdminLog.schema.path('targetModel').options.enum.includes('SafeHub'));
});
