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

const itemService = require('../services/itemService');
const Item = require('../models/Item');
const SafeHub = require('../models/SafeHub');
const SystemSettings = require('../models/SystemSettings');
const User = require('../models/User');
const Notification = require('../models/Notification');
const itemRepository = require('../repositories/itemRepository');
const { toPublicItem, toDonorItem, toReceiverItem } = require('../dtos/itemDto');
const fs = require('node:fs');
const path = require('node:path');

const ITEM_ID = '507f1f77bcf86cd799439011';
const OWNER_ID = '507f1f77bcf86cd799439012';
const OTHER_ID = '507f1f77bcf86cd799439013';
const HUB_ID = '507f1f77bcf86cd799439014';
const BOOKER_ID = '507f1f77bcf86cd799439015';

const queryReturning = (value) => ({
  select() { return this; },
  lean() { return Promise.resolve(value); },
});

test('عقد Controller الخاص بالتعديل والحذف موجود في itemService', () => {
  assert.equal(typeof itemService.updateItemLogic, 'function');
  assert.equal(typeof itemService.deleteItemLogic, 'function');
});

test('عقد العناصر يقبل حالات الغرض المعرفة في Schema فقط', () => {
  const validationSource = fs.readFileSync(
    path.join(__dirname, '../middlewares/validateBody.js'),
    'utf8'
  );
  assert.match(
    validationSource,
    /condition:\s+Joi\.string\(\)\.valid\('جديد', 'مستعمل ممتاز', 'مستعمل جيد'\)/
  );
});

test('تعديل غرض متاح يقتصر على الحقول المسموحة ويتحقق من المركز', async (t) => {
  const originals = {
    findById: Item.findById,
    findOneAndUpdate: Item.findOneAndUpdate,
    findHub: SafeHub.findOne,
    getCached: SystemSettings.getCached,
  };
  t.after(() => {
    Item.findById = originals.findById;
    Item.findOneAndUpdate = originals.findOneAndUpdate;
    SafeHub.findOne = originals.findHub;
    SystemSettings.getCached = originals.getCached;
  });

  let hubFilter;
  let updateFilter;
  let persistedUpdate;

  Item.findById = () => queryReturning({
    _id: ITEM_ID,
    donor: OWNER_ID,
    status: 'متاح',
    cloudinaryId: 'old-image',
  });
  SystemSettings.getCached = async () => ({ categories: ['كتب', 'أثاث'] });
  SafeHub.findOne = (filter) => {
    hubFilter = filter;
    return queryReturning({ _id: HUB_ID });
  };
  Item.findOneAndUpdate = (filter, update) => {
    updateFilter = filter;
    persistedUpdate = update;
    return {
      populate: async () => ({
        toObject: () => ({
          _id: ITEM_ID,
          title: 'كتاب جامعي',
          description: 'بحالة ممتازة',
          category: 'كتب',
          location: 'عمان',
          condition: 'مستعمل ممتاز',
          status: 'متاح',
          donor: { _id: OWNER_ID, name: 'Owner' },
          safeHub: { _id: HUB_ID, name: 'مركز عمان' },
          waitlist: [],
        }),
      }),
    };
  };

  const result = await itemService.updateItemLogic(
    ITEM_ID,
    OWNER_ID,
    {
      title: '  كتاب جامعي  ',
      category: 'كتب',
      safeHub: HUB_ID,
      status: 'تم التسليم',
    },
    null
  );

  assert.equal(result.msg, 'تم تحديث الغرض بنجاح ✅');
  assert.equal(result.item.title, 'كتاب جامعي');
  assert.deepEqual(hubFilter, {
    _id: HUB_ID,
    isActive: { $ne: false },
  });
  assert.deepEqual(updateFilter, {
    _id: ITEM_ID,
    donor: OWNER_ID,
    status: { $in: ['متاح', 'مخفي'] },
  });
  assert.deepEqual(persistedUpdate, {
    $set: {
      title: 'كتاب جامعي',
      category: 'كتب',
      safeHub: HUB_ID,
    },
  });
});

test('التعديل يمنع غير المالك والغرض المحجوز', async (t) => {
  const originalFindById = Item.findById;
  t.after(() => { Item.findById = originalFindById; });

  let snapshot = { donor: OWNER_ID, status: 'متاح' };
  Item.findById = () => queryReturning(snapshot);

  await assert.rejects(
    itemService.updateItemLogic(ITEM_ID, OTHER_ID, { title: 'عنوان جديد' }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN'
  );

  snapshot = { donor: OWNER_ID, status: 'محجوز' };
  await assert.rejects(
    itemService.updateItemLogic(ITEM_ID, OWNER_ID, { title: 'عنوان جديد' }),
    (err) => err.statusCode === 409 && err.code === 'ITEM_NOT_EDITABLE'
  );
});

test('تعارض الحجز أثناء الحفظ لا يكتب تعديلاً متأخراً', async (t) => {
  const originals = {
    findById: Item.findById,
    findOneAndUpdate: Item.findOneAndUpdate,
  };
  t.after(() => {
    Item.findById = originals.findById;
    Item.findOneAndUpdate = originals.findOneAndUpdate;
  });

  Item.findById = () => queryReturning({ donor: OWNER_ID, status: 'متاح' });
  Item.findOneAndUpdate = () => ({ populate: async () => null });

  await assert.rejects(
    itemService.updateItemLogic(ITEM_ID, OWNER_ID, { title: 'عنوان جديد' }),
    (err) => err.statusCode === 409 && err.code === 'ITEM_UPDATE_CONFLICT'
  );
});

test('حذف المالك ذري ولا يسمح لغيره أو بحذف غرض تم تسليمه', async (t) => {
  const originals = {
    findById: Item.findById,
    findOneAndDelete: Item.findOneAndDelete,
  };
  t.after(() => {
    Item.findById = originals.findById;
    Item.findOneAndDelete = originals.findOneAndDelete;
  });

  let snapshot = {
    _id: ITEM_ID,
    donor: OWNER_ID,
    status: 'متاح',
    cloudinaryId: null,
    waitlist: [],
    recipientConfirmed: false,
  };
  let deleteFilter;

  Item.findById = () => queryReturning(snapshot);
  Item.findOneAndDelete = async (filter) => {
    deleteFilter = filter;
    return snapshot;
  };

  await assert.rejects(
    itemService.deleteItemLogic(ITEM_ID, OTHER_ID),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN'
  );

  snapshot = { ...snapshot, status: 'تم التسليم' };
  await assert.rejects(
    itemService.deleteItemLogic(ITEM_ID, OWNER_ID),
    (err) => err.statusCode === 409 && err.code === 'DELIVERED_ITEM_DELETE_FORBIDDEN'
  );

  snapshot = { ...snapshot, status: 'متاح' };
  const result = await itemService.deleteItemLogic(ITEM_ID, OWNER_ID);

  assert.equal(result.msg, 'تم حذف الغرض بنجاح ✅');
  assert.deepEqual(deleteFilter, {
    _id: ITEM_ID,
    donor: OWNER_ID,
    linkedRequestId: null,
    status: { $ne: 'تم التسليم' },
    recipientConfirmed: { $ne: true },
  });
});

test('لا يمكن حذف الغرض بعد أن يؤكد المستلم الاستلام', async (t) => {
  const originalFindById = Item.findById;
  t.after(() => { Item.findById = originalFindById; });
  Item.findById = () => queryReturning({
    _id: ITEM_ID,
    donor: OWNER_ID,
    status: 'محجوز',
    recipientConfirmed: true,
  });

  await assert.rejects(
    itemService.deleteItemLogic(ITEM_ID, OWNER_ID),
    (err) => err.statusCode === 409 && err.code === 'HANDOVER_CONFIRMATION_IN_PROGRESS'
  );
});

test('لا يمكن نقل أو إلغاء الحجز بعد تأكيد المستلم', async (t) => {
  const originalFindById = Item.findById;
  t.after(() => { Item.findById = originalFindById; });
  Item.findById = () => queryReturning({
    _id: ITEM_ID,
    donor: OWNER_ID,
    bookedBy: BOOKER_ID,
    status: 'محجوز',
    recipientConfirmed: true,
    waitlist: [{ user: OTHER_ID }],
  });

  for (const actorId of [OWNER_ID, BOOKER_ID]) {
    await assert.rejects(
      itemService.cancelBookingLogic(ITEM_ID, actorId),
      (err) => err.statusCode === 409 && err.code === 'HANDOVER_CONFIRMATION_IN_PROGRESS'
    );
  }
});

test('مسار العناصر العام لا يمنح الأدمن تجاوز مسار الحذف المدقق', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../controllers/itemController.js'),
    'utf8'
  );
  assert.doesNotMatch(controllerSource, /isAdmin|super_admin/);
});

test('DTO يخفي هوية الحاجز عن العامة ويعيد حالة الانتظار والتسليم للأطراف الصحيحة', () => {
  const item = {
    _id: ITEM_ID,
    title: 'كتاب',
    category: 'كتب',
    condition: 'مستعمل جيد',
    status: 'محجوز',
    donor: { _id: OWNER_ID, name: 'Owner', phone: '+962790000000' },
    bookedBy: {
      _id: BOOKER_ID,
      name: 'Booker',
      email: 'booker@example.test',
      phone: '+962780000000',
      avatar: '/avatar.png',
    },
    safeHub: { _id: HUB_ID, name: 'Hub' },
    waitlist: [{ user: { _id: OTHER_ID }, joinedAt: new Date() }],
    cancelledBy: [BOOKER_ID],
    recipientConfirmed: true,
    donorConfirmed: false,
    expiryHours: 72,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const publicItem = toPublicItem(item, OTHER_ID);
  assert.equal(publicItem.bookedBy, null);
  assert.equal(publicItem.isInWaitlist, true);
  assert.equal(publicItem.bookingPreviouslyCancelled, false);
  assert.equal(publicItem.waitlistCount, 1);
  assert.equal(publicItem.recipientConfirmed, true);
  assert.equal(publicItem.expiryHours, 72);
  assert.equal(publicItem.reportCount, undefined);

  const donorItem = toDonorItem(item, OWNER_ID);
  assert.equal(donorItem.bookedBy.email, 'booker@example.test');
  assert.equal(donorItem.bookedBy.phone, '+962780000000');

  const receiverItem = toReceiverItem(item, BOOKER_ID);
  assert.equal(receiverItem.donor.phone, '+962790000000');
  assert.equal(receiverItem.bookingPreviouslyCancelled, true);
});

test('قائمة التصفح لا تمرر index الخاص بالمصفوفة كهوية مستخدم إلى DTO', async (t) => {
  const originals = {
    find: Item.find,
    countDocuments: Item.countDocuments,
    getCached: SystemSettings.getCached,
  };
  t.after(() => {
    Item.find = originals.find;
    Item.countDocuments = originals.countDocuments;
    SystemSettings.getCached = originals.getCached;
  });

  const items = [
    { _id: ITEM_ID, title: 'First', status: 'متاح', waitlist: [] },
    {
      _id: BOOKER_ID,
      title: 'Second',
      status: 'محجوز',
      waitlist: [{ user: { _id: '1' } }],
    },
  ];
  const query = {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    select() { return this; },
    lean: async () => items,
  };
  Item.find = () => query;
  Item.countDocuments = async () => items.length;
  SystemSettings.getCached = async () => ({ maxPageSize: 20 });

  const result = await itemService.getItemsLogic({ page: 1, limit: 10 });
  assert.equal(result.items[1].isInWaitlist, false);
  assert.equal(result.items[1].waitlistCount, 1);
  assert.equal(result.total, 2);
});

test('الحجز يستخدم maxBookingsPerUser الحقيقي ويمنع تجاوز الحد', async (t) => {
  const originals = {
    userFindById: User.findById,
    itemFindById: Item.findById,
    countDocuments: Item.countDocuments,
    getCached: SystemSettings.getCached,
  };
  t.after(() => {
    User.findById = originals.userFindById;
    Item.findById = originals.itemFindById;
    Item.countDocuments = originals.countDocuments;
    SystemSettings.getCached = originals.getCached;
  });

  User.findById = () => queryReturning({ isVerified: true, trustLevel: 2 });
  Item.findById = () => queryReturning({
    status: 'متاح',
    donor: OWNER_ID,
    bookedBy: null,
    waitlist: [],
    cancelledBy: [],
  });
  SystemSettings.getCached = async () => ({ maxBookingsPerUser: 2 });
  Item.countDocuments = async () => 2;

  await assert.rejects(
    itemService.bookItemLogic(ITEM_ID, OTHER_ID),
    (err) => err.statusCode === 429 && err.code === 'MAX_BOOKINGS_REACHED'
  );
});

test('الحجز المباشر يعيد فحص cancelledBy ذرياً وينظف أي انتظار قديم', async (t) => {
  const originals = {
    userFindById: User.findById,
    itemFindById: Item.findById,
    findOneAndUpdate: Item.findOneAndUpdate,
    countDocuments: Item.countDocuments,
    getCached: SystemSettings.getCached,
  };
  t.after(() => {
    User.findById = originals.userFindById;
    Item.findById = originals.itemFindById;
    Item.findOneAndUpdate = originals.findOneAndUpdate;
    Item.countDocuments = originals.countDocuments;
    SystemSettings.getCached = originals.getCached;
  });

  let updateFilter;
  let updateBody;
  User.findById = () => queryReturning({ isVerified: true, trustLevel: 2 });
  Item.findById = () => queryReturning({
    status: 'متاح',
    donor: OWNER_ID,
    bookedBy: null,
    waitlist: [],
    cancelledBy: [],
  });
  SystemSettings.getCached = async () => ({ maxBookingsPerUser: 3 });
  Item.countDocuments = async () => 0;
  Item.findOneAndUpdate = (filter, update) => {
    updateFilter = filter;
    updateBody = update;
    return { populate: async () => null };
  };

  await assert.rejects(
    itemService.bookItemLogic(ITEM_ID, OTHER_ID),
    (err) => err.statusCode === 409 && err.code === 'ITEM_JUST_BOOKED'
  );
  assert.equal(updateFilter.cancelledBy.$ne.toString(), OTHER_ID);
  assert.equal(updateFilter.donor.$ne.toString(), OTHER_ID);
  assert.equal(updateBody.$pull.waitlist.user.toString(), OTHER_ID);
});

test('الانضمام لقائمة الانتظار يفرض الحالة والسعة وعدم تكرار المستخدم داخل الاستعلام الذري', async (t) => {
  const originals = {
    userFindById: User.findById,
    itemFindById: Item.findById,
    findOneAndUpdate: Item.findOneAndUpdate,
    getCached: SystemSettings.getCached,
  };
  t.after(() => {
    User.findById = originals.userFindById;
    Item.findById = originals.itemFindById;
    Item.findOneAndUpdate = originals.findOneAndUpdate;
    SystemSettings.getCached = originals.getCached;
  });

  let atomicFilter;
  User.findById = () => queryReturning({ isVerified: true, trustLevel: 2 });
  Item.findById = () => queryReturning({
    status: 'محجوز',
    donor: OWNER_ID,
    bookedBy: BOOKER_ID,
    waitlist: [],
    cancelledBy: [],
  });
  SystemSettings.getCached = async () => ({ maxWaitlistPerItem: 4 });
  Item.findOneAndUpdate = async (filter) => {
    atomicFilter = filter;
    return { waitlist: [{ user: OTHER_ID }] };
  };

  const result = await itemService.bookItemLogic(ITEM_ID, OTHER_ID);
  assert.equal(result.waitlisted, true);
  assert.equal(result.position, 1);
  assert.equal(atomicFilter.status, 'محجوز');
  assert.equal(atomicFilter['waitlist.user'].$ne.toString(), OTHER_ID);
  assert.equal(atomicFilter.cancelledBy.$ne.toString(), OTHER_ID);
  assert.equal(atomicFilter.$expr.$lt[1], 4);
});

test('الغرض المخفي لا يظهر لغير مالكه حتى عند معرفة المعرّف', async (t) => {
  const originals = {
    findItemDetails: itemRepository.findItemDetails,
    getCached: SystemSettings.getCached,
  };
  t.after(() => {
    itemRepository.findItemDetails = originals.findItemDetails;
    SystemSettings.getCached = originals.getCached;
  });

  const hidden = {
    _id: ITEM_ID,
    title: 'Hidden',
    status: 'مخفي',
    donor: { _id: OWNER_ID, name: 'Owner' },
    waitlist: [],
    toObject() { return { ...this, toObject: undefined }; },
  };
  itemRepository.findItemDetails = async () => hidden;
  SystemSettings.getCached = async () => ({ bookingExpiryHours: 72 });

  await assert.rejects(
    itemService.getItemByIdLogic(ITEM_ID, OTHER_ID),
    (err) => err.statusCode === 404 && err.code === 'ITEM_NOT_FOUND'
  );
  const ownerView = await itemService.getItemByIdLogic(ITEM_ID, OWNER_ID);
  assert.equal(ownerView._id, ITEM_ID);
});

test('Schema والإجراءات المجدولة متوافقة مع التأكيد المزدوج والحقول الحقيقية للمستخدم', () => {
  const notificationTypes = Notification.schema.path('type').enumValues;
  for (const type of [
    'booking_transferred',
    'booking_expiry_reminder',
    'matching_item',
    'item_deleted',
    'delivery_completed',
  ]) {
    assert.ok(notificationTypes.includes(type), `missing notification type: ${type}`);
  }
  assert.ok(Item.schema.path('reminderSent'));

  const serviceSource = fs.readFileSync(
    path.join(__dirname, '../services/itemService.js'),
    'utf8'
  );
  const cronSource = fs.readFileSync(path.join(__dirname, '../jobs/cronJobs.js'), 'utf8');
  assert.doesNotMatch(serviceSource, /maxActiveBookings(?:PerUser|Level3)/);
  assert.doesNotMatch(serviceSource, /gamification\./);
  assert.match(serviceSource, /minTrustLevelForDonating/);
  assert.match(serviceSource, /utils\/imageValidation/);
  assert.match(serviceSource, /totalDonations:\s*1/);
  assert.match(serviceSource, /leaderboard:update/);
  assert.doesNotMatch(cronSource, /deliveryOtp\s*:/);
  assert.match(cronSource, /reminderSent:\s*true/);
  assert.match(cronSource, /claim\.modifiedCount !== 1/);
  assert.match(cronSource, /recipientConfirmed:\s*\{ \$ne: true \}/);
});
