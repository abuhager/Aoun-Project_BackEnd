const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.CLOUDINARY_CLOUD_NAME ||= 'ci-cloud';
process.env.CLOUDINARY_API_KEY ||= 'ci-key';
process.env.CLOUDINARY_API_SECRET ||= 'ci-secret';
process.env.JWT_SECRET ||= 'review-ci-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'review-ci-refresh-secret';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '7d';
process.env.LOGIN_ALERT_EMAIL_ENABLED = 'false';
process.env.PHONE_VERIFICATION_ENABLED = 'false';
process.env.RUNTIME_TOPOLOGY = 'single';

const User = require('../models/User').default;
const Item = require('../models/Item').default;
const Request = require('../models/DonationRequest').default;
const Offer = require('../models/DonationOffer').default;
const Hub = require('../models/SafeHub').default;
const Conversation = require('../models/Conversation').default;
const Message = require('../models/Message').default;
const Settings = require('../models/SystemSettings').default;
const Log = require('../models/AdminLog').default;
const Outbox = require('../models/OutboxEvent').default;
const BackgroundJobState = require('../models/BackgroundJobState').default;
const { generateAccessToken } = require('../utils/tokenUtils');
const { getBusinessMonthKey } = require('../utils/businessTime');
const { ensureIndexes } = { ensureIndexes: require('../utils/ensureIndexes').default };
const auth = require('../services/authService').default;
const admin = require('../services/adminService').default;
const items = require('../services/itemService').default;
const offers = require('../services/donationRequestService');
const hubs = require('../services/hubService').default;
const rating = require('../repositories/ratingRepository').default;
const users = require('../repositories/userRepository').default;
const outbox = require('../repositories/outboxRepository').default;
const { getRuntimeReadiness } = require('../utils/runtimeHealth');
const { initCronJobs, stopCronJobs } = require('../jobs/cronJobs');
const { initSocket, resetIO } = require('../socket');
const { SOCKET_EVENTS } = require('../socket/contracts');
const app = require('../app').default;

const enabled = process.env.RUN_RUNTIME_INTEGRATION === 'true';

test('خدمات التطبيق وHTTP وSocket مع MongoDB replica set معزولة', { skip: !enabled, timeout: 120000 }, async t => {
  const uri = process.env.MONGO_URI;
  assert.match(uri || '', /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/, 'Integration tests only accept loopback MongoDB');
  const dbName = `aoun_review_ci_${process.pid}`;
  await mongoose.connect(uri, { dbName, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  const { connectRedis, closeRedis } = require('../middlewares/rateLimiter');
  if (process.env.REDIS_URL) await connectRedis();
  const password = 'ReviewSynthetic123!';
  const hash = await bcrypt.hash(password, 10);
  let sequence = 0;
  const user = (extra = {}) => User.create({
    name: `Synthetic user ${++sequence}`, email: `review-${sequence}@aoun.invalid`, password: hash,
    phone: `+962790${String(sequence).padStart(6, '0')}`, isVerified: true, trustLevel: 2, ...extra,
  });
  const [superAdmin, adminA, adminB, demo, donor, requester, outsider] = await Promise.all([
    user({ role: 'super_admin' }), user({ role: 'admin' }), user({ role: 'admin' }),
    user({ role: 'super_admin', isDemo: true }), user(), user(), user(),
  ]);
  await Settings.create({ _id: 'global', universityEmailDomains: ['@student.aoun.invalid'], requireHubForBooking: false });
  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = [];
  t.after(async () => {
    clients.forEach(client => client.disconnect());
    await stopCronJobs();
    await closeRedis();
    await new Promise(resolve => io.close(resolve));
    resetIO();
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    assert.match(mongoose.connection.name, /^aoun_review_ci_\d+$/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  const api = async (actor, path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${generateAccessToken(actor)}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const setSettings = async changes => {
    await Settings.updateOne({ _id: 'global' }, { $set: changes }); Settings.invalidateCache();
  };
  const newItem = extra => Item.create({ title: 'Synthetic item', condition: 'مستعمل جيد', category: 'كتب', location: 'عمان', donor: donor._id, ...extra });
  const makeRequest = async (owner = requester, hub = null) => {
    const request = await Request.create({ requester: owner._id, title: 'طلب تجريبي', category: 'كتب', location: 'عمان', month: getBusinessMonthKey(new Date()), expiresAt: new Date(Date.now() + 86400000) });
    const offer = await Offer.create({ request: request._id, donor: donor._id, condition: 'مستعمل جيد', safeHub: hub });
    return { request, offer };
  };
  const socketFor = async actor => {
    const { io: connect } = require('socket.io-client');
    const socket = connect(base, { auth: { token: generateAccessToken(actor) }, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: 'http://localhost:3000' } });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); setTimeout(() => reject(new Error('socket connect timeout')), 5000).unref(); });
    return socket;
  };
  const ack = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (error, value) => error ? reject(error) : resolve(value)));

  await t.test('حفظ مفتاح الطلبات وسجل الإدارة وبوابة الـAPI ومنع كتابة الديمو', async () => {
    const current = await Settings.findById('global');
    const saved = await api(superAdmin, '/api/settings', 'PATCH', { expectedVersion: current.version, donationRequestsEnabled: false });
    assert.equal(saved.status, 200);
    assert.equal((await Settings.findById('global')).donationRequestsEnabled, false);
    assert.equal((await api(requester, '/api/donation-requests')).body.code, 'DONATION_REQUESTS_DISABLED');
    assert.equal(await Log.countDocuments({ action: 'SETTINGS_UPDATE', adminId: superAdmin._id }), 1);
    const denied = await api(demo, '/api/settings', 'PATCH', { expectedVersion: saved.body.settings.version, donationRequestsEnabled: true });
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'DEMO_READ_ONLY');
    assert.equal((await Settings.findById('global')).donationRequestsEnabled, false);
    await setSettings({ donationRequestsEnabled: true });
  });

  await t.test('التخفيض يصمد بعد الدخول وتجديد الجلسة والهاتف وكتابة ترقية قديمة', async () => {
    const student = await user({ email: 'student@student.aoun.invalid', isVerifiedStudent: true, 'trustEvidence.studentVerified': true });
    await admin.demoteToLevel1(student._id, superAdmin._id, 'super_admin');
    const login = await auth.loginLogic({ email: student.email, password });
    assert.equal(login.statusCode, 200); assert.equal(login.body.user.trustLevel, 1);
    const refreshed = await auth.refreshLogic(login.refreshToken);
    assert.equal(refreshed.body.user.trustLevel, 1);
    await users.updateStudentTrust(student._id, { isVerifiedStudent: true, trustLevel: 2, quota: 5 });
    assert.equal((await User.findById(student._id)).trustLevel, 1);
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const firebaseApp = initializeApp({ projectId: 'demo-review-integration' });
    const stub = t.mock.method(getAuth(), 'verifyIdToken', async () => ({ phone_number: '+962791234567', firebase: { sign_in_provider: 'phone' } }));
    process.env.PHONE_VERIFICATION_ENABLED = 'true'; process.env.PHONE_VERIFICATION_PROMOTES_TRUST = 'true';
    try {
      const result = await require('../services/phoneService').verifyPhoneWithFirebase(student._id, 'synthetic-provider-token');
      assert.equal(result.trustLevel, 1);
      assert.equal((await User.findById(student._id)).isVerifiedStudent, true);
    } finally {
      stub.mock.restore(); await deleteApp(firebaseApp);
      process.env.PHONE_VERIFICATION_ENABLED = 'false'; delete process.env.PHONE_VERIFICATION_PROMOTES_TRUST;
    }
    await admin.promoteToLevel2(student._id, superAdmin._id, 'super_admin');
    assert.equal((await auth.loginLogic({ email: student.email, password })).body.user.trustLevel, 2);
    const promoted = await User.findById(student._id);
    const staleProfile = await users.updateUser(student._id, { trustLevel: 1, quota: 2 });
    assert.equal(staleProfile.trustLevel, 2); assert.equal(staleProfile.quota, promoted.quota);
    const unverified = await user({ email: 'pending-student@student.aoun.invalid', isVerified: false });
    await admin.demoteToLevel1(unverified._id, superAdmin._id, 'super_admin');
    const registration = await users.updateUser(unverified._id, {
      verificationOtp: 'review-synthetic-otp-hash', verificationOtpExpiry: new Date(Date.now() + 600000),
      isVerifiedStudent: true, trustLevel: 2, quota: 5,
    });
    assert.equal(registration.trustLevel, 1);
    const verified = await users.atomicVerifyAndComplete(unverified._id, 'review-synthetic-otp-hash', {
      $set: { isVerified: true, isVerifiedStudent: true, trustLevel: 2, quota: 5, 'trustEvidence.emailVerified': true },
      $inc: { sessionVersion: 1 }, $unset: { verificationOtp: 1, verificationOtpExpiry: 1 },
    });
    assert.equal(verified.trustLevel, 1); assert.equal(verified.quota, registration.quota);
    assert.equal(verified.isVerified, true); assert.equal(verified.verificationOtp, undefined);
    assert.equal(verified.sessionVersion, registration.sessionVersion + 1);
    const fresh = await user({ email: 'new-student@student.aoun.invalid', trustLevel: 1 });
    assert.equal((await auth.loginLogic({ email: fresh.email, password })).body.user.trustLevel, 2);
  });

  await t.test('قبولان متزامنان ينتجان غرضاً وعرضاً مقبولاً واحداً فقط', async () => {
    const { request, offer } = await makeRequest();
    const donor2 = await user();
    const competitor = await Offer.create({ request: request._id, donor: donor2._id, condition: 'جديد' });
    const result = await Promise.allSettled([
      offers.acceptOfferLogic(request._id, offer._id, requester._id),
      offers.acceptOfferLogic(request._id, competitor._id, requester._id),
    ]);
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(await Item.countDocuments({ linkedRequestId: request._id }), 1);
    assert.equal(await Offer.countDocuments({ request: request._id, status: 'accepted' }), 1);
    assert.equal((await Request.findById(request._id)).status, 'fulfilled');
  });

  await t.test('قبول العرض وتعطيل المركز لا يتركان حجزاً في مركز غير نشط', async () => {
    const hub = await Hub.create({ name: 'مركز تجريبي', city: 'عمان', address: 'عنوان تجريبي', createdBy: superAdmin._id });
    const owner = await user(); const { request, offer } = await makeRequest(owner, hub._id);
    const [accepted, deactivated] = await Promise.allSettled([
      offers.acceptOfferLogic(request._id, offer._id, owner._id), hubs.deactivateHub(hub._id, superAdmin._id),
    ]);
    const savedHub = await Hub.findById(hub._id);
    if (accepted.status === 'fulfilled') { assert.equal(savedHub.isActive, true); assert.equal(await Item.countDocuments({ linkedRequestId: request._id }), 1); }
    if (deactivated.status === 'fulfilled' && deactivated.value.statusCode === 200) assert.equal(await Item.countDocuments({ safeHub: hub._id, status: 'محجوز' }), 0);
  });

  await t.test('الحظر يرقّي أول منتظر مؤهل ويحذف المحظور من بقية الطوابير', async () => {
    const booker = await user(); const ineligible = await user({ trustLevel: 1 }); const next = await user();
    const item = await newItem({ status: 'محجوز', bookedBy: booker._id, bookedAt: new Date(), waitlist: [{ user: ineligible._id }, { user: next._id }] });
    const other = await newItem({ waitlist: [{ user: booker._id }] });
    await admin.banUser(booker._id, superAdmin._id, 'super_admin', 'اختبار', null);
    const saved = await Item.findById(item._id);
    assert.equal(String(saved.bookedBy), String(next._id)); assert.equal(saved.status, 'محجوز');
    assert.equal(saved.waitlist.length, 0); assert.equal((await Item.findById(other._id)).waitlist.length, 0);
    assert.equal(await Log.countDocuments({ targetId: booker._id, action: 'BAN' }), 1);
  });

  await t.test('حظر أحد طرفي تلبية طلب يلغي Item وRequest وOffer كوحدة', async () => {
    for (const bannedRole of ['requester', 'donor']) {
      const owner = await user(); const provider = await user();
      const request = await Request.create({ requester: owner._id, title: 'طلب للحظر', category: 'كتب', location: 'عمان', status: 'fulfilled', expiresAt: new Date(Date.now() + 86400000) });
      const item = await newItem({ donor: provider._id, linkedRequestId: request._id, bookedBy: owner._id, bookedAt: new Date(), status: 'محجوز' });
      await Request.updateOne({ _id: request._id }, { $set: { fulfilledByItem: item._id } });
      const offer = await Offer.create({ request: request._id, donor: provider._id, condition: 'جديد', status: 'accepted' });
      await admin.banUser(bannedRole === 'donor' ? provider._id : owner._id, superAdmin._id, 'super_admin', 'اختبار تلبية', null);
      assert.equal((await Item.findById(item._id)).status, 'مخفي');
      assert.equal((await Item.findById(item._id)).bookedBy, null);
      assert.equal((await Request.findById(request._id)).status, 'cancelled');
      assert.equal((await Request.findById(request._id)).fulfilledByItem, null);
      assert.equal((await Offer.findById(offer._id)).status, 'cancelled_by_admin');
    }
  });

  await t.test('سباق الحجز وحد المستخدم يحسمان ذرياً قبل الترقية بالطابور', async () => {
    await setSettings({ maxBookingsPerUser: 1 });
    const booker = await user(); const [a, b] = await Promise.all([newItem(), newItem()]);
    const outcomes = await Promise.allSettled([items.bookItemLogic(a._id, booker._id), items.bookItemLogic(b._id, booker._id)]);
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(await Item.countDocuments({ bookedBy: booker._id, status: 'محجوز' }), 1);
    const dashboard = await items.getMyItemsLogic(booker._id);
    assert.equal(dashboard.usage.bookings.used, 1); assert.equal(dashboard.usage.bookings.remaining, 0);
    await setSettings({ maxBookingsPerUser: 3 });
  });

  await t.test('دعم خاص بمشرفين وSocket حقيقي وعزل الرسائل وحظر الديمو', async () => {
    const opened = await api(requester, '/api/support', 'POST', { subject: 'مشكلة اصطناعية للتكامل' });
    assert.equal(opened.status, 200); const id = opened.body.conversation._id;
    const claims = await Promise.all([api(adminA, `/api/support/${id}/claim`, 'POST'), api(adminB, `/api/support/${id}/claim`, 'POST')]);
    assert.deepEqual(claims.map(row => row.status).sort(), [200, 409]);
    const owner = String((await Conversation.findById(id)).owner) === String(adminA._id) ? adminA : adminB;
    assert.equal((await api(outsider, `/api/conversations/${id}/messages`)).status, 403);
    const socket = await socketFor(requester);
    assert.equal((await ack(socket, SOCKET_EVENTS.JOIN_ROOM, { convId: id })).ok, true);
    assert.equal((await ack(socket, SOCKET_EVENTS.SEND_MESSAGE, { convId: id, text: 'رسالة اختبار خاصة', correlationId: 'review-integration-message-1' })).ok, true);
    assert.equal(await Message.countDocuments({ conversation: id }), 1);
    const privateDemo = await Conversation.create({ kind: 'admin', owner: demo._id, requester: requester._id, participants: [demo._id, requester._id], threadKey: `review-demo:${demo._id}` });
    const demoSocket = await socketFor(demo);
    assert.equal((await ack(demoSocket, SOCKET_EVENTS.JOIN_ROOM, { convId: String(privateDemo._id) })).canSend, false);
    assert.equal((await ack(demoSocket, SOCKET_EVENTS.SEND_MESSAGE, { convId: String(privateDemo._id), text: 'يجب ألا تحفظ' })).code, 'DEMO_READ_ONLY');
    assert.equal(await Message.countDocuments({ conversation: privateDemo._id }), 0);
    assert.equal((await api(owner, `/api/support/${id}/resolve`, 'POST')).status, 200);
    assert.equal((await ack(socket, SOCKET_EVENTS.SEND_MESSAGE, { convId: id, text: 'بعد الإغلاق' })).code, 'CHAT_BOOKING_ENDED');
    assert.equal(await Log.countDocuments({ targetId: new mongoose.Types.ObjectId(id), action: 'SUPPORT_CLAIM' }), 1);
    assert.equal(await Log.countDocuments({ targetId: new mongoose.Types.ObjectId(id), action: 'SUPPORT_RESOLVE' }), 1);
  });

  await t.test('الأقفال المستنفدة تصبح dead والبقية تبقى قابلة للمعالجة', async () => {
    const stale = new Date(Date.now() - 300000);
    const [dead, live] = await Promise.all([
      Outbox.create({ type: 'cloudinary_delete', encryptedPayload: 'synthetic', idempotencyKey: 'review-dead', status: 'processing', attempts: 5, maxAttempts: 5, lockedAt: stale, lockedBy: 'crashed' }),
      Outbox.create({ type: 'verification_email', encryptedPayload: 'synthetic', idempotencyKey: 'review-live', status: 'processing', attempts: 5, maxAttempts: 5, lockedAt: new Date(), lockedBy: 'live' }),
    ]);
    await outbox.recoverExhausted(new Date(Date.now() - 120000));
    assert.equal((await Outbox.findById(dead._id)).status, 'dead');
    assert.equal((await Outbox.findById(live._id)).status, 'processing');
  });

  await t.test('التقييم التالي محدود ويحترم تقييم كل طرف وترتيباً ثابتاً', async () => {
    const rater = await user();
    const [a, b] = await Promise.all([newItem({ donor: rater._id, bookedBy: donor._id, status: 'تم التسليم', deliveredAt: new Date('2026-01-01') }), newItem({ donor: donor._id, bookedBy: rater._id, status: 'تم التسليم', deliveredAt: new Date('2026-02-01') })]);
    const Rating = require('../models/Rating').default;
    await Rating.create({ item: a._id, rater: rater._id, ratee: donor._id, score: 9 });
    assert.equal(String((await rating.findNextPendingRating(rater._id))._id), String(b._id));
    await Rating.create({ item: b._id, rater: donor._id, ratee: rater._id, score: 9 });
    assert.equal(String((await rating.findNextPendingRating(rater._id))._id), String(b._id));
    await Rating.create({ item: b._id, rater: rater._id, ratee: donor._id, score: 8 });
    assert.equal(await rating.findNextPendingRating(rater._id), null);
  });

  await t.test('جاهزية الأعمال تقرأ نتيجة leader مشتركة دون إسقاط خدمة HTTP', async () => {
    await initCronJobs();
    await BackgroundJobState.updateOne({ _id: 'expire-old-bookings' }, { $set: { lastStatus: 'failed', consecutiveFailures: 2, lastRun: new Date(), nextRunAt: new Date(Date.now() + 3600000) } }, { upsert: true });
    const result = await getRuntimeReadiness();
    assert.equal(result.backgroundJobs.ready, false);
    assert.equal(result.backgroundJobs.jobs['expire-old-bookings'].reason, 'REPEATED_FAILURES');
    assert.equal(result.ready, true);
  });
});
