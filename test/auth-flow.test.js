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
process.env.CLIENT_URL = 'https://frontend.example/path-is-ignored';

const validateBody = require('../middlewares/validateBody');
const tokenUtils = require('../utils/tokenUtils');
const sessionCache = require('../utils/sessionCache');
const userRepository = require('../repositories/userRepository');
const authMiddleware = require('../middlewares/auth');
const User = require('../models/User');
const { escapeHtml, getClientOrigin } = require('../services/emailService');
const {
  isPhoneVerificationEnabled,
  requirePhoneVerificationEnabled,
} = require('../middlewares/phoneVerificationFeature');

const runValidation = (schemaName, body) => new Promise((resolve) => {
  const req = { body };
  const response = { statusCode: 200, payload: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(payload) { response.payload = payload; resolve({ req, response }); },
  };
  validateBody(schemaName)(req, res, () => resolve({ req, response }));
});

test('يطبع أرقام الأردن إلى E.164 ويقبل عقد التسجيل الحقيقي', async () => {
  const { req, response } = await runValidation('register', {
    name: 'Adham Ameen',
    email: 'ADHAM@example.com',
    password: 'StrongPass1',
    phone: '0791234567',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(req.body.email, 'adham@example.com');
  assert.equal(req.body.phone, '+962791234567');
});

test('عقد reset-password لا يطلب التوكن داخل body', async () => {
  const { req, response } = await runValidation('resetPassword', {
    password: 'AnotherPass2',
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(req.body, { password: 'AnotherPass2' });
});

test('كل Refresh Token فريد ويحمل رقم نسخة الجلسة', () => {
  const user = {
    _id: '507f1f77bcf86cd799439011',
    role: 'user',
    trustLevel: 1,
    isVerified: true,
    sessionVersion: 7,
  };
  const first = tokenUtils.generateRefreshToken(user).token;
  const second = tokenUtils.generateRefreshToken(user).token;

  assert.notEqual(first, second);
  assert.equal(tokenUtils.verifyRefreshToken(first).user.sessionVersion, 7);
});

test('الهوية والصلاحيات تؤخذ من DB لا من claims قديمة', async (t) => {
  const userId = '507f1f77bcf86cd799439011';
  const original = userRepository.findAuthStateById;
  t.after(() => {
    userRepository.findAuthStateById = original;
    sessionCache.invalidate(userId);
  });

  userRepository.findAuthStateById = async () => ({
    _id: userId,
    name: 'Current Name',
    role: 'admin',
    trustLevel: 2,
    phoneVerified: true,
    isVerified: true,
    isBanned: false,
    isFrozen: false,
    sessionVersion: 3,
    sessionIssuedAt: null,
  });

  const token = tokenUtils.generateAccessToken({
    _id: userId,
    role: 'user',
    trustLevel: 1,
    isVerified: true,
    sessionVersion: 3,
  });
  const identity = await authMiddleware.resolveAccessIdentity(token);

  assert.equal(identity.role, 'admin');
  assert.equal(identity.trustLevel, 2);
  assert.equal(identity.phoneVerified, true);
});

test('اختلاف sessionVersion يبطل Access Token فوراً', async (t) => {
  const userId = '507f1f77bcf86cd799439012';
  const original = userRepository.findAuthStateById;
  t.after(() => {
    userRepository.findAuthStateById = original;
    sessionCache.invalidate(userId);
  });

  userRepository.findAuthStateById = async () => ({
    _id: userId,
    name: 'User',
    role: 'user',
    trustLevel: 1,
    phoneVerified: false,
    isVerified: true,
    isBanned: false,
    isFrozen: false,
    sessionVersion: 9,
    sessionIssuedAt: null,
  });

  const staleToken = tokenUtils.generateAccessToken({
    _id: userId,
    role: 'user',
    trustLevel: 1,
    isVerified: true,
    sessionVersion: 8,
  });

  await assert.rejects(
    authMiddleware.resolveAccessIdentity(staleToken),
    (error) => error.code === 'SESSION_INVALIDATED'
  );
});

test('فهرس الهاتف فريد فقط بعد إثبات ملكية الرقم', () => {
  const phoneIndex = User.schema.indexes().find(([keys]) => keys.phone === 1);
  assert.ok(phoneIndex);
  assert.equal(phoneIndex[1].unique, true);
  assert.deepEqual(phoneIndex[1].partialFilterExpression, { phoneVerified: true });
});

test('قالب البريد يهرب HTML ويبني رابط reset من Origin موثوق', () => {
  assert.equal(escapeHtml('<b>Adham</b>'), '&lt;b&gt;Adham&lt;/b&gt;');
  assert.equal(getClientOrigin(), 'https://frontend.example');
});

test('لا يوجد fallback لهوية ثابتة في Socket chat', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../socket/chatHandlers.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /6a43f5e5cee3421d5c6498dd/);
  assert.match(source, /assertParticipant\(convId, currentUserId\)/);
});

test('trustLevel identity contract stays separate from gamification levels', async () => {
  const { response } = await runValidation('updateSettings', {
    studentDefaultTrustLevel: 3,
  });
  assert.equal(response.statusCode, 422);

  const trustLevel = User.schema.path('trustLevel');
  assert.equal(trustLevel.options.min, 1);
  assert.equal(trustLevel.options.max, 2);
});

test('phone verification is disabled by default and stops before auth or Firebase', () => {
  assert.equal(isPhoneVerificationEnabled({}), false);
  assert.equal(isPhoneVerificationEnabled({ PHONE_VERIFICATION_ENABLED: 'false' }), false);
  assert.equal(isPhoneVerificationEnabled({ PHONE_VERIFICATION_ENABLED: 'true' }), true);

  let nextCalled = false;
  const response = { statusCode: 200, payload: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(payload) { response.payload = payload; return this; },
  };

  const previous = process.env.PHONE_VERIFICATION_ENABLED;
  process.env.PHONE_VERIFICATION_ENABLED = 'false';
  requirePhoneVerificationEnabled({}, res, () => { nextCalled = true; });
  if (previous === undefined) delete process.env.PHONE_VERIFICATION_ENABLED;
  else process.env.PHONE_VERIFICATION_ENABLED = previous;

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.code, 'PHONE_VERIFICATION_DISABLED');
});
