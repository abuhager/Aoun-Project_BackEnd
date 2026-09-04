const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://aoun.example';
process.env.JWT_SECRET = 'reports-test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET = 'reports-test-refresh-secret-123456789';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'reports-test-cloud';
process.env.CLOUDINARY_API_KEY = 'reports-test-key';
process.env.CLOUDINARY_API_SECRET = 'reports-test-secret';

const Report = require('../models/Report');
const Notification = require('../models/Notification');
const SystemSettings = require('../models/SystemSettings');
const reportRepository = require('../repositories/reportRepository');
const userRepository = require('../repositories/userRepository');
const adminRepository = require('../repositories/adminRepository');
const reportService = require('../services/reportService');
const adminService = require('../services/adminService');
const validateBody = require('../middlewares/validateBody');
const sendEmail = require('../utils/sendEmail');

const REPORTER_ID = '507f1f77bcf86cd799439011';
const REPORTED_ID = '507f1f77bcf86cd799439012';
const ITEM_ID = '507f1f77bcf86cd799439013';
const REPORT_ID = '507f1f77bcf86cd799439014';
const ADMIN_ID = '507f1f77bcf86cd799439015';

const readSource = (relativePath) => fs.readFileSync(
  path.join(__dirname, relativePath),
  'utf8'
);

const validContextItem = () => ({
  _id: ITEM_ID,
  donor: REPORTER_ID,
  bookedBy: REPORTED_ID,
  status: 'تم التسليم',
});

test('عقد إنشاء البلاغ يقبل أسماء الحقول الموحدة ويرفض العقد القديم', () => {
  const middleware = validateBody('createReport');
  const req = {
    body: {
      reportedUserId: REPORTED_ID,
      itemId: ITEM_ID,
      reason: ' سبب صالح ',
      details: ' تفاصيل ',
    },
  };
  let nextCalled = false;
  middleware(req, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.body.reason, 'سبب صالح');
  assert.equal(req.body.reportedUserId, REPORTED_ID);

  let responsePayload;
  middleware(
    { body: { reportedUser: REPORTED_ID, reason: 'سبب صالح' } },
    { status: () => ({ json: (payload) => { responsePayload = payload; } }) },
    () => assert.fail('العقد القديم يجب ألا يمر')
  );
  assert.equal(responsePayload.code, 'VALIDATION_ERROR');
});

test('إنشاء البلاغ يتحقق من السبب الديناميكي وطرفي المعاملة ويحفظ بيانات نظيفة', async (t) => {
  const originals = {
    findUser: userRepository.findById,
    settings: SystemSettings.getCached,
    context: reportRepository.findContextItem,
    duplicate: reportRepository.findExistingPending,
    create: reportRepository.createReport,
  };
  t.after(() => {
    userRepository.findById = originals.findUser;
    SystemSettings.getCached = originals.settings;
    reportRepository.findContextItem = originals.context;
    reportRepository.findExistingPending = originals.duplicate;
    reportRepository.createReport = originals.create;
  });

  let stored;
  userRepository.findById = async () => ({ _id: REPORTED_ID, role: 'user' });
  SystemSettings.getCached = async () => ({
    reportReasons: ['سبب ديناميكي'],
    appealWindowHours: 24,
  });
  reportRepository.findContextItem = async () => validContextItem();
  reportRepository.findExistingPending = async () => null;
  reportRepository.createReport = async (payload) => {
    stored = payload;
    return { _id: REPORT_ID, ...payload };
  };

  const startedAt = Date.now();
  const result = await reportService.createReport(REPORTER_ID, {
    reportedUserId: REPORTED_ID,
    itemId: ITEM_ID,
    reason: ' سبب ديناميكي ',
    details: ' تفاصيل البلاغ ',
  });

  assert.equal(result._id, REPORT_ID);
  assert.equal(stored.reason, 'سبب ديناميكي');
  assert.equal(stored.details, 'تفاصيل البلاغ');
  assert.equal(stored.status, 'pending');
  assert.ok(stored.appealDeadline.getTime() >= startedAt + (24 * 60 * 60 * 1000));
});

test('الخدمة ترفض سبباً غير معتمد أو غرضاً لا يجمع طرفي البلاغ', async (t) => {
  const originals = {
    findUser: userRepository.findById,
    settings: SystemSettings.getCached,
    context: reportRepository.findContextItem,
  };
  t.after(() => {
    userRepository.findById = originals.findUser;
    SystemSettings.getCached = originals.settings;
    reportRepository.findContextItem = originals.context;
  });

  userRepository.findById = async () => ({ _id: REPORTED_ID, role: 'user' });
  SystemSettings.getCached = async () => ({ reportReasons: ['سبب معتمد'] });

  await assert.rejects(
    reportService.createReport(REPORTER_ID, {
      reportedUserId: REPORTED_ID,
      reason: 'سبب مزيف',
    }),
    (error) => error.code === 'INVALID_REPORT_REASON' && error.statusCode === 422
  );

  reportRepository.findContextItem = async () => ({
    ...validContextItem(),
    donor: '507f1f77bcf86cd799439099',
  });
  await assert.rejects(
    reportService.createReport(REPORTER_ID, {
      reportedUserId: REPORTED_ID,
      itemId: ITEM_ID,
      reason: 'سبب معتمد',
    }),
    (error) => error.code === 'INVALID_REPORT_CONTEXT' && error.statusCode === 403
  );
});

test('سباق إنشاء بلاغ مكرر يتحول إلى تعارض تشغيلي مفهوم', async (t) => {
  const originals = {
    findUser: userRepository.findById,
    settings: SystemSettings.getCached,
    duplicate: reportRepository.findExistingPending,
    create: reportRepository.createReport,
  };
  t.after(() => {
    userRepository.findById = originals.findUser;
    SystemSettings.getCached = originals.settings;
    reportRepository.findExistingPending = originals.duplicate;
    reportRepository.createReport = originals.create;
  });

  userRepository.findById = async () => ({ _id: REPORTED_ID, role: 'user' });
  SystemSettings.getCached = async () => ({ reportReasons: ['سبب معتمد'] });
  reportRepository.findExistingPending = async () => null;
  reportRepository.createReport = async () => {
    const error = new Error('duplicate key');
    error.code = 11000;
    throw error;
  };

  await assert.rejects(
    reportService.createReport(REPORTER_ID, {
      reportedUserId: REPORTED_ID,
      reason: 'سبب معتمد',
    }),
    (error) => error.code === 'DUPLICATE_REPORT' && error.statusCode === 409
  );
});

test('الاعتراض يخص المستخدم المُبلّغ عنه ويُحفظ ذرياً قبل البت فقط', async (t) => {
  const originals = {
    find: reportRepository.findById,
    submit: reportRepository.submitAppeal,
  };
  t.after(() => {
    reportRepository.findById = originals.find;
    reportRepository.submitAppeal = originals.submit;
  });

  let atomicPayload;
  reportRepository.findById = async () => ({
    _id: REPORT_ID,
    reportedUser: REPORTED_ID,
    status: 'pending',
    appealText: null,
    appealDeadline: new Date(Date.now() + 60_000),
  });
  reportRepository.submitAppeal = async (payload) => {
    atomicPayload = payload;
    return { _id: REPORT_ID, ...payload, status: 'pending' };
  };

  await reportService.submitAppeal(REPORT_ID, REPORTED_ID, {
    appealText: ' اعتراض واضح ومفصل ',
  });
  assert.equal(atomicPayload.userId, REPORTED_ID);
  assert.equal(atomicPayload.appealText, 'اعتراض واضح ومفصل');

  reportRepository.findById = async () => ({
    reportedUser: REPORTED_ID,
    status: 'actioned',
    appealText: null,
  });
  await assert.rejects(
    reportService.submitAppeal(REPORT_ID, REPORTED_ID, {
      appealText: 'اعتراض بعد القرار',
    }),
    (error) => error.code === 'REPORT_ALREADY_RESOLVED'
  );
});

test('قرار المشرف ذري ويسجل الأثر ويبلغ صاحب البلاغ والمستخدم المتأثر', async (t) => {
  const originals = {
    findReport: reportRepository.findByIdPopulated,
    resolve: adminRepository.resolvePendingReport,
    log: adminRepository.logAdminAction,
    settings: SystemSettings.getCached,
    actionedCount: reportRepository.countActionedByReportedUser,
    createNotification: Notification.create,
    fireSendEmail: sendEmail.fireSendEmail,
  };
  t.after(() => {
    reportRepository.findByIdPopulated = originals.findReport;
    adminRepository.resolvePendingReport = originals.resolve;
    adminRepository.logAdminAction = originals.log;
    SystemSettings.getCached = originals.settings;
    reportRepository.countActionedByReportedUser = originals.actionedCount;
    Notification.create = originals.createNotification;
    sendEmail.fireSendEmail = originals.fireSendEmail;
  });

  const notifications = [];
  let audit;
  let resolveCalls = 0;
  const populated = {
    _id: REPORT_ID,
    status: 'pending',
    reason: 'سبب معتمد',
    reporter: { _id: REPORTER_ID, name: 'المُبلّغ', email: 'reporter@example.com' },
    reportedUser: {
      _id: REPORTED_ID,
      name: 'المستخدم',
      email: 'reported@example.com',
      role: 'user',
      isBanned: false,
    },
    relatedItem: { _id: ITEM_ID, title: 'كتاب' },
  };

  reportRepository.findByIdPopulated = async () => populated;
  adminRepository.resolvePendingReport = async () => {
    resolveCalls += 1;
    return { _id: REPORT_ID, reportedUser: REPORTED_ID, status: 'actioned' };
  };
  adminRepository.logAdminAction = async (payload) => { audit = payload; };
  SystemSettings.getCached = async () => ({
    autoReportBanThreshold: 5,
    platformName: 'عون',
  });
  reportRepository.countActionedByReportedUser = async () => 1;
  Notification.create = async (payload) => {
    notifications.push(payload);
    return { ...payload, _id: REPORT_ID, isRead: false, createdAt: new Date() };
  };
  sendEmail.fireSendEmail = async () => undefined;

  await adminService.resolveReport(
    REPORT_ID,
    ADMIN_ID,
    'super_admin',
    'actioned',
    'تم التحقق من الأدلة'
  );

  assert.equal(resolveCalls, 1);
  assert.equal(audit.action, 'REPORT_ACTION');
  assert.deepEqual(
    notifications.map((notification) => notification.type).sort(),
    ['admin_warning', 'report_resolved']
  );
});

test('فهرس البلاغ المفتوح جزئي وقابل للترقية دون منع البلاغات المغلقة اللاحقة', () => {
  const index = Report.schema.indexes().find(([key]) => (
    key.reporter === 1
    && key.reportedUser === 1
    && key.relatedItem === 1
    && key.status === 1
  ));

  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { status: 'pending' });

  const ensureIndexes = readSource('../utils/ensureIndexes.ts');
  assert.match(ensureIndexes, /pending_report_context_unique/);
  assert.match(ensureIndexes, /partialFilterExpression:\s*\{ status: 'pending' \}/);
  assert.match(ensureIndexes, /replaceIfDifferent:\s*true/);
});

test('تجميع تقارير الإدارة يحسب العدادات بمرور واحد ويوازي العدد الكلي', () => {
  const source = readSource('../repositories/adminRepository.ts');
  const section = source.slice(source.indexOf('exports.findPendingReportsWithCounts'));

  assert.equal((section.match(/from:\s*'reports'/g) || []).length, 1);
  assert.match(section, /reportStatsLookup/);
  assert.match(section, /pending:\s*\{[\s\S]*\$cond/);
  assert.match(section, /actioned:\s*\{[\s\S]*\$cond/);
  assert.match(section, /Promise\.all\(\[[\s\S]*reportsQuery\.option[\s\S]*Report\.countDocuments/);
});

test('لوحة التبرعات لا تعرض اعتراضاً على بلاغ موجّه إلى الطرف الآخر', () => {
  const itemRepositorySource = readSource('../repositories/itemRepository.ts');
  const controllerSource = readSource('../controllers/reportController.ts');

  assert.match(
    itemRepositorySource,
    /findDonationsByUser[\s\S]*return attachReportIds\(items, userId\)/
  );
  assert.match(
    controllerSource,
    /reportService\.createReport\(req\.user!?\.id, req\.body\)/
  );
  assert.match(
    controllerSource,
    /reportService\.submitAppeal\([\s\S]*req\.params\.id,[\s\S]*req\.user!?\.id/
  );
});
