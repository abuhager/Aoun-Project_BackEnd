const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.JWT_ISSUER = 'aoun-api';
process.env.JWT_AUDIENCE = 'aoun-web';
process.env.ALLOWED_ORIGINS = 'https://frontend.example';

const {
  SOCKET_EVENTS,
  conversationRoom,
  userRoom,
} = require('../socket/contracts');
const {
  buildSocketServerOptions,
  scheduleTokenLifecycle,
} = require('../socket');

const USER_ID = '507f1f77bcf86cd799439011';
const CONVERSATION_ID = '507f1f77bcf86cd799439012';

test('عقد Flow 9 يعرّف أسماء أحداث فريدة وغرفاً مبنية من Mongo IDs فقط', () => {
  const eventNames = Object.values(SOCKET_EVENTS);
  assert.equal(new Set(eventNames).size, eventNames.length);
  assert.equal(userRoom(USER_ID), `user_${USER_ID}`);
  assert.equal(conversationRoom(CONVERSATION_ID), `conv_${CONVERSATION_ID}`);
  assert.throws(() => userRoom('../admin'), /غير صالح/);
  assert.throws(() => conversationRoom('not-an-object-id'), /غير صالح/);
});

test('الخادم يستعيد الانقطاع المؤقت من دون تجاوز Middleware المصادقة', () => {
  const options = buildSocketServerOptions();
  assert.deepEqual(options.connectionStateRecovery, {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false,
  });
  assert.equal(options.serveClient, false);
  assert.equal(options.maxHttpBufferSize, 100_000);
  assert.equal(options.perMessageDeflate, false);
  assert.equal(options.pingInterval + options.pingTimeout, 45_000);
});

test('Socket handshake يشارك CORS allowlist مع HTTP', async () => {
  const { allowRequest } = buildSocketServerOptions();
  const check = (origin) => new Promise((resolve) => {
    allowRequest({ headers: { origin } }, (_error, allowed) => resolve(allowed));
  });

  assert.equal(await check('https://frontend.example'), true);
  assert.equal(await check('https://evil.example'), false);
});

test('دورة التوكن تطلب التجديد قبل الانتهاء ثم تغلق الاتصال القديم', async () => {
  const events = [];
  const socket = {
    connected: true,
    data: { tokenExpiresAt: Date.now() + 20 },
    emit(event, payload) { events.push({ event, payload }); },
    disconnect(close) {
      assert.equal(close, true);
      this.connected = false;
    },
  };

  const clear = scheduleTokenLifecycle(socket);
  await new Promise((resolve) => setTimeout(resolve, 350));
  clear();

  assert.equal(events[0].event, SOCKET_EVENTS.AUTH_TOKEN_EXPIRING);
  assert.equal(events[1].event, SOCKET_EVENTS.AUTH_TOKEN_EXPIRED);
  assert.equal(socket.connected, false);
});

test('الأحداث العامة تمر عبر emitter موحد ولا تستدعي singleton مباشرة', () => {
  const sources = [
    '../services/itemService.js',
    '../services/adminService.js',
    '../jobs/cronJobs.js',
    '../utils/notifyUser.js',
    '../controllers/adminController.js',
  ].map((relativePath) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8'));

  for (const source of sources) {
    assert.doesNotMatch(source, /require\(['"]\.\.\/socket['"]\)/);
    assert.doesNotMatch(source, /getIO\(\)\.to|`user_\$\{/);
  }
  assert.match(sources[0], /emitToAll\(SOCKET_EVENTS\.LEADERBOARD_UPDATE/);
  assert.match(sources[1], /disconnectUserSockets/);
  assert.doesNotMatch(sources[4], /getIO|disconnectSockets/);
});

test('هوية Socket تحفظ في socket.data القياسي ولا تنشئ حقولاً مخصصة', () => {
  const [authSource, chatSource] = [
    fs.readFileSync(path.join(__dirname, '../socket/auth.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../socket/chatHandlers.js'), 'utf8'),
  ];

  assert.match(authSource, /socket\.data =/);
  assert.match(chatSource, /socket\.data\.userId/);
  assert.doesNotMatch(authSource, /socket\.userId\s*=/);
  assert.doesNotMatch(chatSource, /socket\.userId/);
});
