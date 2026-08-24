const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'https://frontend.example';
process.env.COOKIE_SECRET = 'test-cookie-secret';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '30d';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const { parseAllowedOrigins } = require('../config/cors');
const { validateEnvironment } = require('../config/env');
const { verifySocketToken } = require('../socket/auth');
const { generateAccessToken } = require('../utils/tokenUtils');
const { buildMongoOptions } = require('../config/db');
const { indexDefinitionsEquivalent } = require('../utils/ensureIndexes');
const app = require('../app');

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('يفشل التحقق من بيئة production عند ضعف الأسرار', () => {
  const env = {
    MONGO_URI: 'mongodb://localhost:27017/aoun',
    JWT_SECRET: 'short',
    JWT_REFRESH_SECRET: 'short',
    JWT_ACCESS_EXPIRE: '15m',
    JWT_REFRESH_EXPIRE: '30d',
    ALLOWED_ORIGINS: 'https://frontend.example',
    CLOUDINARY_CLOUD_NAME: 'cloud',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
    COOKIE_SECRET: 'short',
    NODE_ENV: 'production',
  };

  assert.throws(() => validateEnvironment(env), { code: 'INVALID_ENVIRONMENT' });
});

test('ينظف Origins المكررة ويرفض Origin يحتوي مساراً', () => {
  assert.deepEqual(
    parseAllowedOrigins('https://a.example, https://a.example, http://localhost:3000'),
    ['https://a.example', 'http://localhost:3000']
  );
  assert.throws(() => parseAllowedOrigins('https://a.example/path'));
});

test('لا يمرر family إلى MongoDB في الوضع التلقائي', () => {
  const previousFamily = process.env.MONGO_IP_FAMILY;

  process.env.MONGO_IP_FAMILY = '0';
  assert.equal('family' in buildMongoOptions(), false);

  process.env.MONGO_IP_FAMILY = '4';
  assert.equal(buildMongoOptions().family, 4);

  if (previousFamily === undefined) delete process.env.MONGO_IP_FAMILY;
  else process.env.MONGO_IP_FAMILY = previousFamily;
});

test('يعتبر فهرسين متطابقين حتى لو اختلف اسمهما فقط', () => {
  assert.equal(indexDefinitionsEquivalent(
    { key: { status: 1, createdAt: -1 }, name: 'status_1_createdAt_-1' },
    { key: { status: 1, createdAt: -1 }, name: 'status_createdAt' }
  ), true);

  assert.equal(indexDefinitionsEquivalent(
    { key: { email: 1 }, name: 'email_1', unique: true },
    { key: { email: 1 }, name: 'email_lookup' }
  ), false);
});

test('يرفض Socket token المفقود أو غير الصالح ويقبل هوية MongoDB صحيحة', () => {
  assert.throws(() => verifySocketToken(null, 'secret'), /مطلوب تسجيل الدخول/);
  assert.throws(() => verifySocketToken('not-a-token', 'secret'), /غير صالح/);

  const token = generateAccessToken({
    _id: '507f1f77bcf86cd799439011',
    role: 'user',
    trustLevel: 1,
    isVerified: true,
    sessionVersion: 0,
  });
  const verified = verifySocketToken(token);
  assert.equal(verified.id, '507f1f77bcf86cd799439011');
  assert.ok(verified.expiresAt > Date.now());
});

test('يعيد liveness بنجاح ويولّد Request ID آمناً', async () => {
  const response = await fetch(`${baseUrl}/health/live`, {
    headers: {
      origin: 'https://frontend.example',
      'x-request-id': 'unsafe request id',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example');
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  assert.equal((await response.json()).status, 'ok');
});

test('يرفض CORS Origin غير المصرح به', async () => {
  const response = await fetch(`${baseUrl}/health/live`, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).code, 'CORS_ORIGIN_DENIED');
});

test('يعيد readiness بحالة degraded عند غياب MongoDB', async () => {
  const response = await fetch(`${baseUrl}/health/ready`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).database, 'disconnected');
});
