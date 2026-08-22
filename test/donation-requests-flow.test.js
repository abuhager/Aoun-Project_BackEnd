const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const donationRequestService = require('../services/donationRequestService');
const donationRequestController = require('../controllers/donationRequestController');
const donationRequestRepository = require('../repositories/donationRequestRepository');
const donationOfferRepository = require('../repositories/donationOfferRepository');
const itemRepository = require('../repositories/itemRepository');
const SystemSettings = require('../models/SystemSettings');
const DonationRequest = require('../models/DonationRequest');
const DonationOffer = require('../models/DonationOffer');
const Notification = require('../models/Notification');
const SafeHub = require('../models/SafeHub');
const User = require('../models/User');
const Item = require('../models/Item');
const socket = require('../socket');
const { toPublicOffer } = require('../dtos/donationOfferDto');
const itemService = require('../services/itemService');
const conversationService = require('../services/conversationService');

const REQUEST_ID = '507f1f77bcf86cd799439011';
const REQUESTER_ID = '507f1f77bcf86cd799439012';
const DONOR_ID = '507f1f77bcf86cd799439013';
const HUB_ID = '507f1f77bcf86cd799439014';
const OFFER_ID = '507f1f77bcf86cd799439015';
const WINNER_ID = '507f1f77bcf86cd799439016';
const OTHER_ID = '507f1f77bcf86cd799439017';
const ITEM_ID = '507f1f77bcf86cd799439066';

const queryReturning = (value) => ({
  select() { return this; },
  session() { return this; },
  lean() { return Promise.resolve(value); },
});

test('طلب التبرع يُؤرشف عند الانتهاء ولا يملك TTL يحذفه', () => {
  const indexes = DonationRequest.schema.indexes();
  assert.equal(indexes.some(([, options]) => options.expireAfterSeconds !== undefined), false);
  assert.ok(DonationRequest.schema.path('status').enumValues.includes('processing'));
});

test('حالات العرض تغطي السحب والإلغاء والانتهاء', () => {
  const values = DonationOffer.schema.path('status').enumValues;
  assert.ok(values.includes('withdrawn'));
  assert.ok(values.includes('cancelled_by_requester'));
  assert.ok(values.includes('request_expired'));
});

test('مهمة الفهارس تزيل TTL القديم وتمنع تكرار المتبرع والغرض المرتبط', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utils/ensureIndexes.js'), 'utf8');
  assert.match(source, /dropObsoleteDonationRequestTtlIndexes/);
  assert.match(source, /name: 'request_donor_unique'/);
  assert.match(source, /name: 'linked_request_unique'/);
  assert.doesNotMatch(source, /name: 'ttl_expiresAt'/);
});

test('إنشاء الطلب يحترم minTrustLevelForRequests الديناميكي', async (t) => {
  const originals = {
    findUser: User.findById,
    settings: SystemSettings.getCached,
  };
  t.after(() => {
    User.findById = originals.findUser;
    SystemSettings.getCached = originals.settings;
  });

  User.findById = () => queryReturning({ isVerified: true, trustLevel: 1 });
  SystemSettings.getCached = async () => ({ minTrustLevelForRequests: 2 });

  await assert.rejects(
    donationRequestService.createRequestLogic({
      title: 'طلب كتاب',
      description: 'أحتاج كتاباً للدراسة',
      category: 'كتب',
      location: 'عمان',
    }, REQUESTER_ID),
    (error) => error.statusCode === 403 && error.code === 'INSUFFICIENT_TRUST_LEVEL'
  );
});

test('عداد الواجهة الشهرية يطابق عداد الإنشاء بما فيها الطلبات الملغية', async (t) => {
  const originals = {
    findRequests: donationRequestRepository.findUserRequests,
    countAll: donationRequestRepository.countAllMonthlyRequests,
    countActive: donationRequestRepository.countActiveMonthlyRequests,
    settings: SystemSettings.getCached,
  };
  t.after(() => {
    donationRequestRepository.findUserRequests = originals.findRequests;
    donationRequestRepository.countAllMonthlyRequests = originals.countAll;
    donationRequestRepository.countActiveMonthlyRequests = originals.countActive;
    SystemSettings.getCached = originals.settings;
  });

  donationRequestRepository.findUserRequests = async () => [];
  donationRequestRepository.countAllMonthlyRequests = async () => 2;
  donationRequestRepository.countActiveMonthlyRequests = async () => {
    throw new Error('يجب ألا يُستخدم العداد النشط هنا');
  };
  SystemSettings.getCached = async () => ({ maxActiveRequestsPerMonth: 3 });

  const result = await donationRequestService.getMyRequestsLogic(REQUESTER_ID);
  assert.deepEqual(result.quota, { used: 2, max: 3, remaining: 1 });
});

test('إيقاف ميزة الهاتف لا يمنع Level 1 من تقديم عرض صالح', async (t) => {
  const originals = {
    request: donationRequestRepository.findActiveRequestById,
    exists: donationOfferRepository.existsByRequestAndDonor,
    pending: donationOfferRepository.countPendingOffersByDonor,
    create: donationOfferRepository.createOffer,
    findUser: User.findById,
    findHub: SafeHub.findOne,
    settings: SystemSettings.getCached,
    createNotification: Notification.create,
    getIO: socket.getIO,
    startSession: mongoose.startSession,
    updateRequest: DonationRequest.updateOne,
    phoneFlag: process.env.PHONE_VERIFICATION_ENABLED,
  };
  t.after(() => {
    donationRequestRepository.findActiveRequestById = originals.request;
    donationOfferRepository.existsByRequestAndDonor = originals.exists;
    donationOfferRepository.countPendingOffersByDonor = originals.pending;
    donationOfferRepository.createOffer = originals.create;
    User.findById = originals.findUser;
    SafeHub.findOne = originals.findHub;
    SystemSettings.getCached = originals.settings;
    Notification.create = originals.createNotification;
    socket.getIO = originals.getIO;
    mongoose.startSession = originals.startSession;
    DonationRequest.updateOne = originals.updateRequest;
    if (originals.phoneFlag === undefined) delete process.env.PHONE_VERIFICATION_ENABLED;
    else process.env.PHONE_VERIFICATION_ENABLED = originals.phoneFlag;
  });

  process.env.PHONE_VERIFICATION_ENABLED = 'false';
  donationRequestRepository.findActiveRequestById = async () => ({
    _id: REQUEST_ID,
    title: 'حاسوب للدراسة',
    requester: { _id: REQUESTER_ID },
  });
  User.findById = () => queryReturning({
    _id: DONOR_ID,
    name: 'متبرع',
    isVerified: true,
    phoneVerified: false,
    trustLevel: 1,
  });
  SystemSettings.getCached = async () => ({
    minTrustLevelForDonating: 1,
    maxPendingOffersPerDonor: 5,
  });
  donationOfferRepository.existsByRequestAndDonor = async () => false;
  donationOfferRepository.countPendingOffersByDonor = async () => 0;
  SafeHub.findOne = (filter) => {
    assert.deepEqual(filter, { _id: HUB_ID, isActive: { $ne: false } });
    return queryReturning({ _id: HUB_ID });
  };
  donationOfferRepository.createOffer = async () => ({ _id: OFFER_ID });
  Notification.create = async (payload) => ({
    _id: '507f1f77bcf86cd799439099',
    ...payload,
    metadata: payload.metadata ?? {},
    isRead: false,
    createdAt: new Date(),
  });
  socket.getIO = () => ({ to: () => ({ emit: () => {} }) });
  mongoose.startSession = async () => {
    let active = false;
    return {
      startTransaction() { active = true; },
      inTransaction() { return active; },
      async commitTransaction() { active = false; },
      async abortTransaction() { active = false; },
      async endSession() {},
    };
  };
  DonationRequest.updateOne = async () => ({ matchedCount: 1 });

  const result = await donationRequestService.submitOfferLogic(
    REQUEST_ID,
    DONOR_ID,
    { safeHub: HUB_ID, condition: 'مستعمل جيد', description: '' },
    null
  );
  assert.deepEqual(result, {
    msg: 'تم إرسال عرضك لصاحب الطلب بنجاح 🎉',
    offerId: OFFER_ID,
    status: 'pending',
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test('تفاصيل الطلب العامة لا تفترض وجود req.user', async (t) => {
  const original = donationRequestService.getRequestByIdLogic;
  t.after(() => { donationRequestService.getRequestByIdLogic = original; });

  let viewerId = 'not-called';
  let viewerRole = 'not-called';
  donationRequestService.getRequestByIdLogic = async (_id, value, role) => {
    viewerId = value;
    viewerRole = role;
    return { _id: REQUEST_ID };
  };

  const payload = await new Promise((resolve, reject) => {
    donationRequestController.getRequestById(
      { params: { id: REQUEST_ID }, user: null },
      { json: resolve },
      reject
    );
  });

  assert.equal(viewerId, null);
  assert.equal(viewerRole, 'user');
  assert.deepEqual(payload, { request: { _id: REQUEST_ID } });
});

test('تفاصيل الطلب لا تكشف الغرض الفائز لصاحب عرض مرفوض أو للزائر', async (t) => {
  const originals = {
    request: donationRequestRepository.findRequestByIdWithItem,
    viewerOffer: donationOfferRepository.findViewerOffer,
  };
  t.after(() => {
    donationRequestRepository.findRequestByIdWithItem = originals.request;
    donationOfferRepository.findViewerOffer = originals.viewerOffer;
  });

  const request = {
    _id: REQUEST_ID,
    title: 'حاسوب للدراسة',
    category: 'إلكترونيات',
    urgency: 'high',
    location: 'عمان',
    status: 'fulfilled',
    requester: { _id: REQUESTER_ID, name: 'صاحب الطلب' },
    fulfilledByItem: {
      _id: ITEM_ID,
      status: 'محجوز',
      condition: 'مستعمل جيد',
      donor: { _id: WINNER_ID, name: 'المتبرع الفائز' },
      safeHub: { name: 'مركز عمان', city: 'عمان', address: 'الشارع الرئيسي' },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  donationRequestRepository.findRequestByIdWithItem = async () => request;
  donationOfferRepository.findViewerOffer = async (_requestId, donorId) => ({
    _id: donorId === WINNER_ID ? OFFER_ID : '507f1f77bcf86cd799439018',
    status: donorId === WINNER_ID ? 'accepted' : 'rejected',
    createdAt: new Date(),
  });

  const guest = await donationRequestService.getRequestByIdLogic(REQUEST_ID);
  const rejected = await donationRequestService.getRequestByIdLogic(
    REQUEST_ID,
    DONOR_ID,
    'user'
  );
  const winner = await donationRequestService.getRequestByIdLogic(
    REQUEST_ID,
    WINNER_ID,
    'user'
  );
  const owner = await donationRequestService.getRequestByIdLogic(
    REQUEST_ID,
    REQUESTER_ID,
    'user'
  );
  const admin = await donationRequestService.getRequestByIdLogic(
    REQUEST_ID,
    OTHER_ID,
    'admin'
  );

  assert.equal(guest.fulfilledByItem, null);
  assert.equal(rejected.viewerOffer.status, 'rejected');
  assert.equal(rejected.fulfilledByItem, null);
  assert.equal(winner.viewerOffer.status, 'accepted');
  assert.equal(winner.fulfilledByItem._id, ITEM_ID);
  assert.equal(owner.fulfilledByItem._id, ITEM_ID);
  assert.equal(admin.fulfilledByItem._id, ITEM_ID);
});

test('الغرض المرتبط بطلب لا يظهر في التصفح ولا يفتح لغير طرفيه أو الإدارة', async (t) => {
  const originals = {
    find: Item.find,
    count: Item.countDocuments,
    details: itemRepository.findItemDetails,
    settings: SystemSettings.getCached,
  };
  t.after(() => {
    Item.find = originals.find;
    Item.countDocuments = originals.count;
    itemRepository.findItemDetails = originals.details;
    SystemSettings.getCached = originals.settings;
  });

  let browseFilter;
  const emptyQuery = {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    select() { return this; },
    lean: async () => [],
  };
  Item.find = (filter) => {
    browseFilter = filter;
    return emptyQuery;
  };
  Item.countDocuments = async () => 0;
  SystemSettings.getCached = async () => ({ maxPageSize: 20, bookingExpiryHours: 72 });

  await itemService.getItemsLogic({ page: 1, limit: 10 });
  assert.equal(browseFilter.linkedRequestId, null);

  const linkedItem = {
    _id: ITEM_ID,
    title: 'حاسوب مخصص للطلب',
    status: 'محجوز',
    linkedRequestId: REQUEST_ID,
    donor: { _id: WINNER_ID, name: 'المتبرع الفائز' },
    bookedBy: { _id: REQUESTER_ID, name: 'صاحب الطلب' },
    waitlist: [],
    toObject() {
      return { ...this, toObject: undefined };
    },
  };
  itemRepository.findItemDetails = async () => linkedItem;

  await assert.rejects(
    itemService.getItemByIdLogic(ITEM_ID, OTHER_ID, 'user'),
    (error) => error.statusCode === 404 && error.code === 'ITEM_NOT_FOUND'
  );
  assert.equal(
    (await itemService.getItemByIdLogic(ITEM_ID, WINNER_ID, 'user'))._id,
    ITEM_ID
  );
  assert.equal(
    (await itemService.getItemByIdLogic(ITEM_ID, REQUESTER_ID, 'user'))._id,
    ITEM_ID
  );
  assert.equal(
    (await itemService.getItemByIdLogic(ITEM_ID, OTHER_ID, 'super_admin'))._id,
    ITEM_ID
  );
});

test('مسارات الحجز والإلغاء والحذف العامة مقفلة للغرض المرتبط بالطلب', async (t) => {
  const originals = {
    findUser: User.findById,
    findItem: Item.findById,
    settings: SystemSettings.getCached,
  };
  t.after(() => {
    User.findById = originals.findUser;
    Item.findById = originals.findItem;
    SystemSettings.getCached = originals.settings;
  });

  User.findById = () => queryReturning({ isVerified: true, trustLevel: 2 });
  SystemSettings.getCached = async () => ({ maxBookingsPerUser: 3 });
  Item.findById = () => queryReturning({
    _id: ITEM_ID,
    title: 'حاسوب مخصص للطلب',
    status: 'محجوز',
    linkedRequestId: REQUEST_ID,
    donor: WINNER_ID,
    bookedBy: REQUESTER_ID,
    waitlist: [],
    cancelledBy: [],
  });

  await assert.rejects(
    itemService.bookItemLogic(ITEM_ID, OTHER_ID),
    (error) => error.statusCode === 404 && error.code === 'ITEM_NOT_FOUND'
  );
  await assert.rejects(
    itemService.bookItemLogic(ITEM_ID, WINNER_ID),
    (error) => error.statusCode === 409 && error.code === 'REQUEST_LINKED_ITEM_LOCKED'
  );
  await assert.rejects(
    itemService.cancelBookingLogic(ITEM_ID, REQUESTER_ID),
    (error) => error.statusCode === 409 && error.code === 'REQUEST_LINKED_ITEM_LOCKED'
  );
  await assert.rejects(
    itemService.deleteItemLogic(ITEM_ID, WINNER_ID),
    (error) => error.statusCode === 409 && error.code === 'REQUEST_LINKED_ITEM_LOCKED'
  );
});

test('محادثة الغرض الخاص لا تُفتح لغير المتبرع والمستلم الفعليين', async (t) => {
  const originals = {
    findUser: User.findById,
    findItem: Item.findById,
  };
  t.after(() => {
    User.findById = originals.findUser;
    Item.findById = originals.findItem;
  });

  User.findById = () => queryReturning({ _id: WINNER_ID });
  Item.findById = () => queryReturning({
    _id: ITEM_ID,
    donor: WINNER_ID,
    bookedBy: REQUESTER_ID,
  });

  await assert.rejects(
    conversationService.openConversationLogic({
      itemId: ITEM_ID,
      userId: OTHER_ID,
      donorId: WINNER_ID,
      io: null,
    }),
    (error) => error.statusCode === 403 && error.code === 'CHAT_FORBIDDEN'
  );
});

test('العناصر المرتبطة مستثناة من انتهاء الحجز العام والملف العام للمستخدم', () => {
  const cronSource = fs.readFileSync(path.join(__dirname, '../jobs/cronJobs.js'), 'utf8');
  const profileSource = fs.readFileSync(
    path.join(__dirname, '../repositories/profileRepository.js'),
    'utf8'
  );

  assert.match(cronSource, /if \(item\.linkedRequestId\) return/);
  assert.match(cronSource, /expire-old-bookings[\s\S]*linkedRequestId:\s*null/);
  assert.match(cronSource, /booking-reminder[\s\S]*linkedRequestId:\s*null/);
  assert.match(profileSource, /findPublicDonations[\s\S]*linkedRequestId:\s*null/);
  assert.match(profileSource, /findPublicReceivedItems[\s\S]*linkedRequestId:\s*null/);
});

test('DTO العرض لا يكشف cloudinaryId الداخلي', () => {
  const output = toPublicOffer({
    _id: OFFER_ID,
    request: REQUEST_ID,
    status: 'pending',
    condition: 'جديد',
    imageUrl: 'https://example.com/image.jpg',
    cloudinaryId: 'private-public-id',
    donor: { _id: DONOR_ID, name: 'متبرع' },
    safeHub: { _id: HUB_ID, name: 'مركز', city: 'عمان', address: 'شارع' },
    createdAt: new Date(),
  });

  assert.equal(output.imageUrl, 'https://example.com/image.jpg');
  assert.equal(Object.hasOwn(output, 'cloudinaryId'), false);
});

test('حارس الانتهاء يعامل الطلب النشط القديم كمنتهٍ', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  assert.equal(
    donationRequestService._private.isPastExpiry({
      status: 'active',
      expiresAt: new Date('2026-08-22T11:59:59.000Z'),
    }, now),
    true
  );
  assert.equal(
    donationRequestService._private.isPastExpiry({
      status: 'fulfilled',
      expiresAt: new Date('2026-08-22T11:59:59.000Z'),
    }, now),
    false
  );
});

test('قبول العرض ينشئ غرضاً محجوزاً مرة واحدة ويرفض بقية العروض داخل transaction', async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    settings: SystemSettings.getCached,
    claimRequest: DonationRequest.findOneAndUpdate,
    finishRequest: DonationRequest.updateOne,
    claimOffer: DonationOffer.findOneAndUpdate,
    findOffers: DonationOffer.find,
    updateOffers: DonationOffer.updateMany,
    findUser: User.findOne,
    findHub: SafeHub.findOne,
    countItems: Item.countDocuments,
    createItem: Item.create,
    createNotification: Notification.create,
    getIO: socket.getIO,
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    SystemSettings.getCached = originals.settings;
    DonationRequest.findOneAndUpdate = originals.claimRequest;
    DonationRequest.updateOne = originals.finishRequest;
    DonationOffer.findOneAndUpdate = originals.claimOffer;
    DonationOffer.find = originals.findOffers;
    DonationOffer.updateMany = originals.updateOffers;
    User.findOne = originals.findUser;
    SafeHub.findOne = originals.findHub;
    Item.countDocuments = originals.countItems;
    Item.create = originals.createItem;
    Notification.create = originals.createNotification;
    socket.getIO = originals.getIO;
  });

  let active = false;
  mongoose.startSession = async () => ({
    startTransaction() { active = true; },
    inTransaction() { return active; },
    async commitTransaction() { active = false; },
    async abortTransaction() { active = false; },
    async endSession() {},
  });
  SystemSettings.getCached = async () => ({
    minTrustLevelForRequests: 2,
    minTrustLevelForDonating: 1,
    maxBookingsPerUser: 3,
    maxActiveDonationsPerUser: 2,
    maxActiveDonationsLevel2Plus: 4,
  });

  let requestFilter;
  DonationRequest.findOneAndUpdate = async (filter) => {
    requestFilter = filter;
    return {
      _id: REQUEST_ID,
      requester: REQUESTER_ID,
      title: 'حاسوب للدراسة',
      description: 'طلب واضح',
      category: 'إلكترونيات',
      location: 'عمان',
    };
  };
  DonationOffer.findOneAndUpdate = () => queryReturning({
    _id: OFFER_ID,
    request: REQUEST_ID,
    donor: DONOR_ID,
    safeHub: HUB_ID,
    status: 'accepted',
    condition: 'مستعمل جيد',
    description: 'حاسوب صالح',
    imageUrl: null,
    cloudinaryId: null,
  });
  DonationOffer.find = () => queryReturning([{
    _id: '507f1f77bcf86cd799439088',
    donor: '507f1f77bcf86cd799439077',
    cloudinaryId: null,
  }]);
  DonationOffer.updateMany = async () => ({ modifiedCount: 1 });

  User.findOne = (filter) => queryReturning(
    filter._id === REQUESTER_ID
      ? { _id: REQUESTER_ID, trustLevel: 2 }
      : { _id: DONOR_ID, name: 'متبرع', trustLevel: 1, phoneVerified: false }
  );
  SafeHub.findOne = () => queryReturning({
    _id: HUB_ID,
    name: 'مركز عمان',
    city: 'عمان',
    address: 'الشارع الرئيسي',
  });
  Item.countDocuments = () => ({ session: async () => 0 });

  let itemPayload;
  Item.create = async (payload) => {
    [itemPayload] = payload;
    return [{ _id: '507f1f77bcf86cd799439066' }];
  };
  DonationRequest.updateOne = async () => ({ modifiedCount: 1 });
  const notificationPayloads = [];
  Notification.create = async (payload) => {
    notificationPayloads.push(payload);
    return {
      _id: '507f1f77bcf86cd799439099',
      ...payload,
      metadata: payload.metadata ?? {},
      isRead: false,
      createdAt: new Date(),
    };
  };
  socket.getIO = () => ({ to: () => ({ emit: () => {} }) });

  const result = await donationRequestService.acceptOfferLogic(
    REQUEST_ID,
    OFFER_ID,
    REQUESTER_ID
  );

  assert.equal(requestFilter.status, 'active');
  assert.ok(requestFilter.expiresAt.$gt instanceof Date);
  assert.equal(itemPayload.status, 'محجوز');
  assert.equal(itemPayload.bookedBy, REQUESTER_ID);
  assert.equal(itemPayload.linkedRequestId, REQUEST_ID);
  assert.deepEqual(result, {
    msg: 'تم اختيار المتبرع وحجز الغرض بنجاح 🎉',
    itemId: '507f1f77bcf86cd799439066',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const rejectedNotification = notificationPayloads.find(
    (payload) => payload.type === 'offer_rejected'
  );
  assert.ok(rejectedNotification);
  assert.equal(rejectedNotification.itemId, null);
  assert.equal(rejectedNotification.actionUrl, `/donation-requests/${REQUEST_ID}`);
});

test('العقود الذرية تفحص expiry وتدعم قبول ورفض وسحب العرض', () => {
  const [serviceSource, routesSource, cronSource, itemServiceSource] = [
    '../services/donationRequestService.js',
    '../routes/donationRequests.js',
    '../jobs/cronJobs.js',
    '../services/itemService.js',
  ].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8'));

  assert.match(serviceSource, /status: 'processing'/);
  assert.match(serviceSource, /expiresAt: \{ \$gt: now \}/);
  assert.match(serviceSource, /cleanupOfferImages\(rejectedOffers/);
  assert.match(serviceSource, /deleteFromCloudinary\(uploaded\.public_id\)/);
  assert.match(routesSource, /:offerId\/reject/);
  assert.match(routesSource, /:offerId\/withdraw/);
  assert.match(routesSource, /validateObjectId\('offerId'\)/);
  assert.match(cronSource, /expireDonationRequestsLogic/);
  assert.doesNotMatch(cronSource, /DonationRequest\.updateMany/);
  assert.match(itemServiceSource, /status:\s+'active',[\s\S]*expiresAt:\s+\{ \$gt: new Date\(\) \}/);
});
