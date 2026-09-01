const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'https://frontend.example';
process.env.COOKIE_SECRET = 'test-cookie-secret-that-is-long-enough-12345';
process.env.JWT_SECRET = 'test-access-secret-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-12345';
process.env.JWT_ACCESS_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '7d';

const AppError = require('../utils/AppError');
const { validateEnvironment } = require('../config/env');
const {
  requireTrustedBrowserRequest,
} = require('../middlewares/requestSecurity');
const {
  hashOtp,
  legacyHashOtp,
  verifyOtp,
} = require('../utils/otp');
const {
  buildCookieConfiguration,
} = require('../utils/tokenUtils');
const {
  fileFilter,
  verifyMagicBytes,
} = require('../middlewares/upload');
const {
  DEFAULT_MAX_IMAGE_SIZE,
  resolveMaxImageSize,
} = require('../utils/imageValidation');
const { _private: limiterKeys } = require('../middlewares/rateLimiter');
const errorHandler = require('../middlewares/errorHandler');

const read = (relativePath) => fs.readFileSync(
  path.join(__dirname, '..', relativePath),
  'utf8'
);

const runRequestGuard = ({
  method = 'POST',
  origin,
  fetchSite,
  contentType = 'application/json',
} = {}) => new Promise((resolve) => {
  const headers = {};
  if (origin) headers.origin = origin;
  if (fetchSite) headers['sec-fetch-site'] = fetchSite;
  const req = {
    method,
    headers,
    is: (expected) => expected === 'application/json' && contentType === 'application/json',
  };
  requireTrustedBrowserRequest(req, {}, (error) => resolve(error ?? null));
});

const secureProductionEnv = () => ({
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb+srv://cluster.example/aoun',
  JWT_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  JWT_ACCESS_EXPIRE: '15m',
  JWT_REFRESH_EXPIRE: '7d',
  ALLOWED_ORIGINS: 'https://frontend.example',
  CLIENT_URL: 'https://frontend.example',
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
  COOKIE_SECRET: 'c'.repeat(64),
});

test('بيئة production تفرض HTTPS وفصل الأسرار ومدداً محدودة', () => {
  assert.doesNotThrow(() => validateEnvironment(secureProductionEnv()));

  assert.throws(
    () => validateEnvironment({
      ...secureProductionEnv(),
      ALLOWED_ORIGINS: 'http://frontend.example',
      CLIENT_URL: 'http://frontend.example',
    }),
    /HTTPS/
  );

  assert.throws(
    () => validateEnvironment({
      ...secureProductionEnv(),
      COOKIE_SECRET: 'a'.repeat(64),
    }),
    /يجب أن تكون مختلفة/
  );

  assert.throws(
    () => validateEnvironment({
      ...secureProductionEnv(),
      JWT_ACCESS_EXPIRE: '2h',
    }),
    /بين دقيقة وساعة/
  );
});

test('حارس Cookie endpoints يرفض cross-site وغير JSON ويقبل Origin الموثوق', async () => {
  const crossSite = await runRequestGuard({
    origin: 'https://frontend.example',
    fetchSite: 'cross-site',
  });
  assert.equal(crossSite.code, 'CROSS_SITE_REQUEST_BLOCKED');

  const untrusted = await runRequestGuard({ origin: 'https://evil.example' });
  assert.equal(untrusted.code, 'UNTRUSTED_REQUEST_ORIGIN');

  const formPost = await runRequestGuard({
    origin: 'https://frontend.example',
    contentType: 'application/x-www-form-urlencoded',
  });
  assert.equal(formPost.code, 'JSON_CONTENT_TYPE_REQUIRED');
  assert.equal(formPost.statusCode, 415);

  assert.equal(await runRequestGuard({ origin: 'https://frontend.example' }), null);
  assert.equal(await runRequestGuard(), null);
});

test('OTP الجديد يستخدم HMAC ويقبل الرموز القديمة فقط للتوافق الانتقالي', () => {
  const otp = '123456';
  const current = hashOtp(otp);
  const legacy = legacyHashOtp(otp);

  assert.notEqual(current, legacy);
  assert.equal(verifyOtp(otp, current), true);
  assert.equal(verifyOtp(otp, legacy), true);
  assert.equal(verifyOtp('654321', current), false);
});

test('كوكي production محمية وSameSite=Lax مع اسم ترحيل منفصل', () => {
  const production = buildCookieConfiguration({
    NODE_ENV: 'production',
    JWT_REFRESH_EXPIRE: '7d',
  });
  assert.equal(production.REFRESH_COOKIE_NAME, '__Secure-aoun_refresh');
  assert.equal(production.REFRESH_COOKIE_OPTIONS.secure, true);
  assert.equal(production.REFRESH_COOKIE_OPTIONS.httpOnly, true);
  assert.equal(production.REFRESH_COOKIE_OPTIONS.sameSite, 'lax');
  assert.equal(production.REFRESH_COOKIE_OPTIONS.path, '/api/auth');
  assert.equal(production.LEGACY_REFRESH_COOKIE_NAME, 'refreshToken');

  const development = buildCookieConfiguration({
    NODE_ENV: 'development',
    JWT_REFRESH_EXPIRE: '7d',
  });
  assert.equal(development.REFRESH_COOKIE_NAME, 'refreshToken');
  assert.equal(development.REFRESH_COOKIE_OPTIONS.secure, false);
});

test('رفع الصور يفرض نوعاً فعلياً وحدوداً آمنة للملف والحقول', async () => {
  assert.equal(resolveMaxImageSize('not-a-number'), DEFAULT_MAX_IMAGE_SIZE);
  assert.equal(resolveMaxImageSize(String(50 * 1024 * 1024)), DEFAULT_MAX_IMAGE_SIZE);
  assert.equal(
    verifyMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'),
    true
  );
  assert.equal(
    verifyMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/jpeg'),
    false
  );

  const rejected = await new Promise((resolve) => {
    fileFilter({}, {
      originalname: 'payload.svg',
      mimetype: 'image/svg+xml',
    }, (error, accepted) => resolve({ error, accepted }));
  });
  assert.ok(rejected.error instanceof AppError);
  assert.equal(rejected.error.code, 'INVALID_IMAGE_TYPE');
  assert.equal(rejected.accepted, false);

  const uploadSource = read('middlewares/upload.ts');
  assert.match(uploadSource, /fields:\s*12/);
  assert.match(uploadSource, /fieldSize:\s*16 \* 1024/);
  assert.match(uploadSource, /parts:\s*13/);
});

test('مفاتيح Rate Limit لا تكشف البريد أو reset token وتعمل عبر كل IPs', () => {
  const emailRequestA = { body: { email: 'Victim@Example.com' }, ip: '127.0.0.1' };
  const emailRequestB = { body: { email: 'victim@example.com' }, ip: '192.0.2.1' };
  const emailKey = limiterKeys.emailKeyGenerator(emailRequestA);

  assert.equal(emailKey, limiterKeys.emailKeyGenerator(emailRequestB));
  assert.doesNotMatch(emailKey, /victim|example/i);

  const token = 'f'.repeat(64);
  const tokenKey = limiterKeys.tokenKeyGenerator({ body: { token }, ip: '127.0.0.1' });
  assert.doesNotMatch(tokenKey, new RegExp(token));

  const donationRoutes = read('routes/donationRequests.ts');
  const itemRoutes = read('routes/items.ts');
  assert.doesNotMatch(donationRoutes, /express-rate-limit|strictLimiter/);
  assert.match(donationRoutes, /donationActionLimiter/);
  assert.match(donationRoutes, /uploadLimiter/);
  assert.match(itemRoutes, /actionLimiter/);
  assert.match(itemRoutes, /uploadLimiter/);
});

test('رسائل production لا تسرّب أكواد أو تفاصيل أخطاء داخلية', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousConsoleError = console.error;
  process.env.NODE_ENV = 'production';
  console.error = () => {};

  try {
    let statusCode;
    let payload;
    const res = {
      headersSent: false,
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
    };
    errorHandler(
      Object.assign(new Error('mongodb://user:password@private-host'), {
        code: 'ECONNREFUSED_PRIVATE_HOST',
      }),
      {
        id: 'safe-request-id',
        headers: {},
        path: '/api/private',
        method: 'GET',
      },
      res,
      () => {}
    );

    assert.equal(statusCode, 500);
    assert.equal(payload.code, 'INTERNAL_SERVER_ERROR');
    assert.doesNotMatch(JSON.stringify(payload), /password|private-host|ECONNREFUSED/);
    assert.equal('stack' in payload, false);
  } finally {
    console.error = previousConsoleError;
    process.env.NODE_ENV = previousEnv;
  }
});

test('reset token لا يوجد في API path وملفات اعتماد التشغيل المحلية مستثناة من Git', () => {
  const authRoutes = read('routes/auth.ts');
  const emailService = read('services/emailService.ts');
  const gitignore = read('.gitignore');

  assert.match(authRoutes, /router\.post\('\/reset-password'/);
  assert.doesNotMatch(authRoutes, /reset-password\/:token/);
  assert.match(authRoutes, /requireTrustedBrowserRequest/);
  assert.match(emailService, /reset-password#token=/);
  assert.match(gitignore, /auth_info\//);
  assert.match(gitignore, /\.runtime\//);
});
