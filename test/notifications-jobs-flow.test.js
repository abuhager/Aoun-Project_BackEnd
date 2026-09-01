const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://aoun.example';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const Notification = require('../models/Notification');
const User = require('../models/User');
const SystemSettings = require('../models/SystemSettings');
const notificationRepository = require('../repositories/notificationRepository');
const notificationService = require('../services/notificationService');
const notifyUser = require('../utils/notifyUser');
const cronJobs = require('../jobs/cronJobs');
const sendEmail = require('../utils/sendEmail');

const USER_ID = '507f1f77bcf86cd799439011';
const ITEM_ID = '507f1f77bcf86cd799439012';
const NOTIFICATION_ID = '507f1f77bcf86cd799439013';

const queryReturning = (value) => ({
  select() { return this; },
  lean() { return Promise.resolve(value); },
});

test('عقد Notification يقيّد المحتوى وروابط الإجراءات الداخلية', () => {
  assert.ok(Notification.NOTIFICATION_TYPES.includes('admin_ban'));
  assert.ok(Notification.NOTIFICATION_TYPES.includes('new_message'));
  assert.equal(Notification.schema.path('title').options.maxlength, 160);
  assert.equal(Notification.schema.path('body').options.maxlength, 1000);

  assert.equal(Notification.isInternalActionPath('/items/123?tab=chat'), true);
  assert.equal(Notification.isInternalActionPath('//evil.example'), false);
  assert.equal(Notification.isInternalActionPath('/\\evil.example'), false);
  assert.equal(Notification.isInternalActionPath('javascript:alert(1)'), false);

  assert.equal(
    notifyUser.normalizeActionUrl('  /items/123  '),
    '/items/123'
  );
  assert.throws(
    () => notifyUser.normalizeActionUrl('https://evil.example'),
    (error) => error.code === 'INVALID_NOTIFICATION_ACTION_URL'
  );
});

test('خدمة الإشعارات تطبق الحد الأعلى وتعيد DTO بلا هوية المستخدم الداخلية', async (t) => {
  const originals = {
    findLatest: notificationRepository.findLatestByUser,
    countUnread: notificationRepository.countUnreadByUser,
    countAll: notificationRepository.countByUser,
  };
  t.after(() => {
    notificationRepository.findLatestByUser = originals.findLatest;
    notificationRepository.countUnreadByUser = originals.countUnread;
    notificationRepository.countByUser = originals.countAll;
  });

  let receivedLimit;
  notificationRepository.findLatestByUser = async (_userId, limit) => {
    receivedLimit = limit;
    return [{
      _id: NOTIFICATION_ID,
      user: 'should-not-leak',
      type: 'matching_item',
      title: 'غرض مطابق',
      body: 'يوجد غرض جديد',
      itemId: ITEM_ID,
      conversationId: null,
      actionUrl: `/items/${ITEM_ID}`,
      metadata: { requestId: 'request-1' },
      isRead: false,
      createdAt: new Date('2026-08-24T12:00:00.000Z'),
      __v: 9,
    }];
  };
  notificationRepository.countUnreadByUser = async () => 4;
  notificationRepository.countByUser = async () => 75;

  const result = await notificationService.getNotificationsLogic(
    USER_ID,
    { limit: '999' }
  );

  assert.equal(receivedLimit, 50);
  assert.equal(result.limit, 50);
  assert.equal(result.unreadCount, 4);
  assert.equal(result.totalCount, 75);
  assert.equal(result.hasMore, true);
  assert.equal(result.notifications[0]._id, NOTIFICATION_ID);
  assert.equal(result.notifications[0].itemId, ITEM_ID);
  assert.equal('user' in result.notifications[0], false);
  assert.equal('__v' in result.notifications[0], false);
});

test('تعليم إشعار واحد لا ينجح لإشعار لا يملكه المستخدم', async (t) => {
  const original = notificationRepository.markOneReadByUser;
  t.after(() => {
    notificationRepository.markOneReadByUser = original;
  });

  notificationRepository.markOneReadByUser = async () => null;
  await assert.rejects(
    notificationService.markOneReadLogic(NOTIFICATION_ID, USER_ID),
    (error) =>
      error.statusCode === 404
      && error.code === 'NOTIFICATION_NOT_FOUND'
  );
});

test('notifyUser يوحد عقد Socket ويجلب البريد الحرج ويهرب HTML', async (t) => {
  const originals = {
    create: Notification.create,
    userFindById: User.findById,
    getCached: SystemSettings.getCached,
    fireSendEmail: sendEmail.fireSendEmail,
  };
  const createdPayloads = [];
  let emailLookupCount = 0;
  let emailPayload = null;

  t.after(() => {
    Notification.create = originals.create;
    User.findById = originals.userFindById;
    SystemSettings.getCached = originals.getCached;
    sendEmail.fireSendEmail = originals.fireSendEmail;
  });

  Notification.create = async (payload) => {
    createdPayloads.push(payload);
    return {
      ...payload,
      _id: NOTIFICATION_ID,
      isRead: false,
      createdAt: new Date('2026-08-24T12:00:00.000Z'),
    };
  };
  User.findById = () => {
    emailLookupCount += 1;
    return queryReturning({ email: 'member@example.com' });
  };
  SystemSettings.getCached = async () => ({ platformName: '<عون>' });
  sendEmail.fireSendEmail = async (payload) => {
    emailPayload = payload;
  };

  await notifyUser(USER_ID, {
    type: 'matching_item',
    title: '  غرض مطابق  ',
    body: '  يوجد غرض جديد  ',
    itemId: ITEM_ID,
    actionUrl: `/items/${ITEM_ID}`,
    metadata: { requestId: 'request-1' },
  });

  assert.equal(createdPayloads[0].title, 'غرض مطابق');
  assert.equal(createdPayloads[0].body, 'يوجد غرض جديد');
  assert.equal(createdPayloads[0].metadata.actionUrl, undefined);
  assert.equal(emailLookupCount, 0);

  await notifyUser(USER_ID, {
    type: 'admin_warning',
    title: '<b>تحذير</b>',
    body: '<script>alert(1)</script>',
    actionUrl: '/dashboard?tab=<warning>',
  });

  assert.equal(emailLookupCount, 1);
  assert.equal(emailPayload.email, 'member@example.com');
  assert.match(emailPayload.message, /&lt;b&gt;تحذير&lt;\/b&gt;/);
  assert.match(emailPayload.message, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(emailPayload.message, /<script>/);
  assert.match(emailPayload.message, /https:\/\/aoun\.example\/dashboard/);
  assert.match(emailPayload.message, /فتح منصة &lt;عون&gt;/);

  await assert.rejects(
    notifyUser(USER_ID, {
      type: 'matching_item',
      title: 'رابط خارجي',
      body: 'مرفوض',
      actionUrl: '//evil.example',
    }),
    (error) => error.code === 'INVALID_NOTIFICATION_ACTION_URL'
  );
});

test('تشغيل Cron متزامن لا يكرر المهام أو المستمع ويُغلقها بالكامل', async (t) => {
  const originalGetCached = SystemSettings.getCached;
  const { settingsEvents } = SystemSettings;
  const listenersBefore = settingsEvents.listenerCount('invalidated');

  SystemSettings.getCached = async () => ({
    quotaResetDayOfMonth: 1,
    bookingExpiryHours: 24,
  });

  t.after(async () => {
    await cronJobs.stopCronJobs();
    SystemSettings.getCached = originalGetCached;
  });

  const [first, second] = await Promise.all([
    cronJobs.initCronJobs(),
    cronJobs.initCronJobs(),
  ]);

  assert.deepEqual(Object.keys(first), Object.keys(second));
  assert.equal(
    settingsEvents.listenerCount('invalidated'),
    listenersBefore + 1
  );
  for (const status of Object.values(cronJobs.getCronStatus())) {
    assert.equal(status.scheduled, true);
  }

  await cronJobs.stopCronJobs();
  assert.equal(
    settingsEvents.listenerCount('invalidated'),
    listenersBefore
  );
  for (const status of Object.values(cronJobs.getCronStatus())) {
    assert.equal(status.scheduled, false);
  }
});

test('حالة Cron تسجل النجاح والفشل والمدة من دون رفض غير معالج', async () => {
  await cronJobs.runSafe('booking-reminder', async () => {});
  let status = cronJobs.getCronStatus()['booking-reminder'];
  assert.equal(status.lastStatus, 'success');
  assert.equal(typeof status.lastDurationMs, 'number');
  assert.ok(status.lastFinishedAt instanceof Date);

  await cronJobs.runSafe('booking-reminder', async () => {
    throw new Error('expected-job-failure');
  });
  status = cronJobs.getCronStatus()['booking-reminder'];
  assert.equal(status.lastStatus, 'failed');
  assert.equal(status.lastError, 'expected-job-failure');
});

test('عقد Flow 11 يغلق Cron بأمان ويزيل النسخة القديمة ويغطي نافذة التذكير', () => {
  const jobsSource = fs.readFileSync(
    path.join(__dirname, '../jobs/cronJobs.ts'),
    'utf8'
  );
  const serverSource = fs.readFileSync(
    path.join(__dirname, '../server.ts'),
    'utf8'
  );
  const appSource = fs.readFileSync(
    path.join(__dirname, '../app.ts'),
    'utf8'
  );
  const adminSource = fs.readFileSync(
    path.join(__dirname, '../services/adminService.ts'),
    'utf8'
  );

  assert.match(jobsSource, /noOverlap:\s*true/);
  assert.match(jobsSource, /'\*\/15 \* \* \* \*'/);
  assert.match(jobsSource, /75 \* 60 \* 1000/);
  assert.match(jobsSource, /MAX_BOOKING_JOB_BATCH/);
  assert.match(serverSource, /await stopCronJobs\(\)/);
  assert.match(appSource, /backgroundJobs:\s*getBackgroundJobsHealth\(\)/);
  assert.match(adminSource, /type:\s*'admin_ban'/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '../utils/cronJobs.ts')),
    false
  );
});
