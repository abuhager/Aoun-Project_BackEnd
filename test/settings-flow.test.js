const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'settings-test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET = 'settings-test-refresh-secret-123456789';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'settings-test-cloud';
process.env.CLOUDINARY_API_KEY = 'settings-test-key';
process.env.CLOUDINARY_API_SECRET = 'settings-test-secret';

const SystemSettings = require('../models/SystemSettings');
const Item = require('../models/Item');
const DonationOffer = require('../models/DonationOffer');
const AdminLog = require('../models/AdminLog');
const settingsService = require('../services/settingsService');
const adminService = require('../services/adminService');
const {
  EDITABLE_SETTING_FIELDS,
  assertSettingsInvariants,
  updateSettings,
} = require('../dtos/settingsDto');
const {
  createMaintenanceMode,
  isAllowedPath,
} = require('../middlewares/maintenanceMode');
const { SOCKET_EVENTS } = require('../socket/contracts');

const readSource = (relativePath) => fs.readFileSync(
  path.join(__dirname, relativePath),
  'utf8'
);

test('عقد الإعدادات يغطي كل الحقول التشغيلية ويرفض الحقول غير المعروفة', () => {
  const payload = {
    defaultUserQuota: 3,
    level2Quota: 6,
    maxWaitlistPerItem: 12,
    locations: ['عمان', 'إربد'],
    appealWindowHours: 48,
    requireHubForBooking: true,
    maintenanceMode: false,
  };

  const { error, value } = updateSettings.validate(payload, { abortEarly: false });
  assert.equal(error, undefined);
  assert.deepEqual(value, payload);
  assert.ok(EDITABLE_SETTING_FIELDS.includes('maxWaitlistPerItem'));
  assert.ok(EDITABLE_SETTING_FIELDS.includes('locations'));
  assert.ok(EDITABLE_SETTING_FIELDS.includes('appealWindowHours'));

  const invalid = updateSettings.validate({ defaultQuota: 5 });
  assert.equal(invalid.error?.details[0].type, 'object.unknown');
});

test('قواعد الإعدادات تمنع حدود تقييم أو تبرعات متناقضة', () => {
  const valid = {
    ratingThresholdExcellent: 9,
    ratingThresholdGood: 7,
    ratingThresholdNeutral: 5,
    ratingThresholdBad: 3,
    maxActiveDonationsPerUser: 2,
    maxActiveDonationsLevel2Plus: 4,
  };

  assert.doesNotThrow(() => assertSettingsInvariants(valid));
  assert.throws(
    () => assertSettingsInvariants({ ...valid, ratingThresholdGood: 9 }),
    { code: 'INVALID_RATING_THRESHOLDS' }
  );
  assert.throws(
    () => assertSettingsInvariants({ ...valid, maxActiveDonationsLevel2Plus: 1 }),
    { code: 'INVALID_DONATION_LIMITS' }
  );
});

test('الإعدادات العامة لا تكشف إلا العقد الآمن المطلوب للواجهة', () => {
  const projected = settingsService.toPublicSettings({
    categories: ['كتب'],
    locations: ['عمان'],
    reportReasons: ['سبب'],
    platformName: 'عون التجريبي',
    contactEmail: 'support@example.com',
    maxAvatarSizeMb: 8,
    requireHubForBooking: true,
    maintenanceMode: true,
    updatedAt: new Date('2026-08-24T10:00:00.000Z'),
    universityEmailDomains: ['@private.example'],
  });

  assert.deepEqual(Object.keys(projected).sort(), [
    'categories',
    'contactEmail',
    'locations',
    'maintenanceMode',
    'maxAvatarSizeMb',
    'platformName',
    'reportReasons',
    'requireHubForBooking',
    'updatedAt',
  ].sort());
  assert.equal(projected.updatedAt, '2026-08-24T10:00:00.000Z');
  assert.equal('universityEmailDomains' in projected, false);
});

test('تحديث الإعدادات يحفظ الفروق فقط ويبطل الكاش ويسجل الأثر الإداري', async () => {
  const current = {
    _id: 'global',
    platformName: 'عون',
    categories: ['كتب'],
    locations: ['عمان'],
    reportReasons: ['سبب'],
    ratingThresholdExcellent: 9,
    ratingThresholdGood: 7,
    ratingThresholdNeutral: 5,
    ratingThresholdBad: 3,
    maxActiveDonationsPerUser: 2,
    maxActiveDonationsLevel2Plus: 4,
  };
  const originals = {
    getInstance: SystemSettings.getInstance,
    findOneAndUpdate: SystemSettings.findOneAndUpdate,
    invalidateCache: SystemSettings.invalidateCache,
    createLog: AdminLog.create,
  };
  let databaseUpdate;
  let invalidated;
  let audit;

  SystemSettings.getInstance = async () => ({ ...current });
  SystemSettings.findOneAndUpdate = (_filter, update) => {
    databaseUpdate = update;
    return { lean: async () => ({ ...current, ...update.$set }) };
  };
  SystemSettings.invalidateCache = (fields) => { invalidated = fields; };
  AdminLog.create = async (payload) => { audit = payload; return payload; };

  try {
    const result = await settingsService.updateSettings(
      { platformName: ' عون الجامعات ', categories: ['كتب'] },
      '507f1f77bcf86cd799439011'
    );

    assert.deepEqual(databaseUpdate, { $set: { platformName: 'عون الجامعات' } });
    assert.deepEqual(result.changedFields, ['platformName']);
    assert.deepEqual(invalidated, ['platformName']);
    assert.equal(audit.action, 'SETTINGS_UPDATE');
    assert.deepEqual(audit.meta.changedFields, ['platformName']);
  } finally {
    SystemSettings.getInstance = originals.getInstance;
    SystemSettings.findOneAndUpdate = originals.findOneAndUpdate;
    SystemSettings.invalidateCache = originals.invalidateCache;
    AdminLog.create = originals.createLog;
  }
});

test('وضع الصيانة يسمح بالصحة العامة والمصادقة والإدارة ويحجب بقية المستخدمين', async () => {
  assert.equal(isAllowedPath('/auth/login'), true);
  assert.equal(isAllowedPath('/settings/public'), true);
  assert.equal(isAllowedPath('/items'), false);

  const buildResponse = () => ({
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
  });

  const blocked = createMaintenanceMode({
    getSettings: async () => ({ maintenanceMode: true }),
    resolveIdentity: async () => ({ role: 'user' }),
  });
  const blockedResponse = buildResponse();
  let blockedError;
  await blocked(
    { path: '/items', headers: { authorization: 'Bearer valid' } },
    blockedResponse,
    (error) => { blockedError = error; }
  );
  assert.equal(blockedError.code, 'MAINTENANCE_MODE');
  assert.equal(blockedError.statusCode, 503);
  assert.equal(blockedResponse.headers['Retry-After'], '300');

  const adminAllowed = createMaintenanceMode({
    getSettings: async () => ({ maintenanceMode: true }),
    resolveIdentity: async () => ({ role: 'super_admin' }),
  });
  let adminNext = false;
  await adminAllowed(
    { path: '/settings', headers: { authorization: 'Bearer valid' } },
    buildResponse(),
    (error) => { assert.equal(error, undefined); adminNext = true; }
  );
  assert.equal(adminNext, true);
});

test('Safe Hub اختياري في التخزين ويصبح إلزامياً من الإعداد التشغيلي', () => {
  assert.notEqual(Item.schema.path('safeHub').options.required, true);
  assert.notEqual(DonationOffer.schema.path('safeHub').options.required, true);

  const itemService = readSource('../services/itemService.ts');
  const requestService = readSource('../services/donationRequestService.ts');
  assert.match(itemService, /settings\.requireHubForBooking && !body\.safeHub/);
  assert.match(itemService, /settings\.requireHubForBooking && !snapshot\.safeHub/);
  assert.match(requestService, /settings\.requireHubForBooking && !offer\.safeHub/);
  assert.match(requestService, /safeHub: hub\?\._id \?\? null/);
});

test('عتبة الحظر تعتمد البلاغات المعتمدة وتطهر العناصر والحجوزات وقائمة الانتظار', async () => {
  const originalUpdateMany = Item.updateMany;
  const updates = [];
  Item.updateMany = async (filter, update) => {
    updates.push({ filter, update });
    return { acknowledged: true };
  };

  try {
    await adminService.applyBanConsequences('507f1f77bcf86cd799439011');
  } finally {
    Item.updateMany = originalUpdateMany;
  }

  assert.equal(updates.length, 3);
  assert.deepEqual(updates[0].update.$set.status, 'مخفي');
  assert.deepEqual(updates[1].update.$set.status, 'متاح');
  assert.deepEqual(updates[2].update.$pull, {
    waitlist: { user: '507f1f77bcf86cd799439011' },
  });

  const service = readSource('../services/adminService.ts');
  const repository = readSource('../repositories/adminRepository.ts');
  assert.match(service, /countActionedByReportedUser/);
  assert.match(service, /actionedCount >= threshold/);
  assert.match(service, /target\.role === 'user'/);
  assert.match(repository, /actionedReportsAgainstUser/);
  assert.match(repository, /repeatOffenderThreshold/);
});

test('التحديث الحي والـCron يستخدمان عقد الأحداث والحقول المتغيرة فقط', () => {
  assert.equal(SOCKET_EVENTS.SETTINGS_UPDATED, 'settings:updated');

  const cron = readSource('../jobs/cronJobs.ts');
  const service = readSource('../services/settingsService.ts');
  const routes = readSource('../routes/settings.ts');
  assert.match(cron, /changedFields\.includes\('quotaResetDayOfMonth'\)/);
  assert.match(service, /emitToAll\(SOCKET_EVENTS\.SETTINGS_UPDATED/);
  assert.match(routes, /requireSuperAdmin[\s\S]*validateBody\('updateSettings'\)/);
});
