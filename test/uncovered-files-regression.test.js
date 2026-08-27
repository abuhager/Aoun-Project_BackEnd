const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assertSafeSeedEnvironment } = require('../scripts/seed');
const baileys = require('../integrations/baileys');
const whatsappService = require('../integrations/whatsappService');

const read = (relativePath) => fs.readFileSync(
  path.join(__dirname, '..', relativePath),
  'utf8'
);

const safeSeedEnv = {
  NODE_ENV: 'development',
  ALLOW_DESTRUCTIVE_SEED: 'true',
  MONGO_URI: 'mongodb://127.0.0.1:27017/aoun_seed_test',
  SEED_TARGET_DB: 'aoun_seed_test',
  SEED_DEMO_PASSWORD: 'strong-demo-password',
  BCRYPT_ROUNDS: '10',
};

test('seed المدمر يتطلب موافقة صريحة ولا يعمل في production', () => {
  assert.throws(
    () => assertSafeSeedEnvironment({ ...safeSeedEnv, NODE_ENV: 'production' }),
    /production/
  );
  assert.throws(
    () => assertSafeSeedEnvironment({ ...safeSeedEnv, ALLOW_DESTRUCTIVE_SEED: 'false' }),
    /ALLOW_DESTRUCTIVE_SEED/
  );
  assert.throws(
    () => assertSafeSeedEnvironment({ ...safeSeedEnv, SEED_TARGET_DB: '' }),
    /SEED_TARGET_DB/
  );
  assert.throws(
    () => assertSafeSeedEnvironment({ ...safeSeedEnv, SEED_DEMO_PASSWORD: 'short' }),
    /SEED_DEMO_PASSWORD/
  );
  assert.deepEqual(assertSafeSeedEnvironment(safeSeedEnv), {
    nodeEnv: 'development',
    destructiveOptIn: 'true',
    mongoUri: safeSeedEnv.MONGO_URI,
    targetDb: 'aoun_seed_test',
    demoPassword: 'strong-demo-password',
    bcryptRounds: 10,
  });
});

test('seed يستخدم عقد المحادثات والرسائل الحالي ولا يحتوي أسراراً افتراضية', () => {
  const source = read('scripts/seed.js');

  assert.match(source, /require\('\.\.\/models\/Message'\)/);
  assert.match(source, /owner: donor\._id/);
  assert.match(source, /requester: requester\._id/);
  assert.match(source, /Message\.create\(/);
  assert.match(source, /mongoose\.connection\.name/);
  assert.match(source, /if \(require\.main === module\)/);
  assert.doesNotMatch(source, /mongodb:\/\/localhost/);
  assert.doesNotMatch(source, /1870547aA/);
  assert.doesNotMatch(source, /messages:\s*\[/);
});

test('حفظ التقييم وتحديث الثقة والغرض يتم داخل transaction واحدة', () => {
  const service = read('services/ratingService.js');
  const repository = read('repositories/ratingRepository.js');
  const commitIndex = service.indexOf('await session.commitTransaction()');
  const notificationIndex = service.indexOf('await notifyUser(');

  assert.match(service, /mongoose\.startSession\(\)/);
  assert.match(service, /session\.startTransaction\(\)/);
  assert.match(service, /findItemById\(itemId, session\)/);
  assert.match(service, /createRating\([\s\S]*\}, session\)/);
  assert.match(service, /markItemRated\(itemId, session\)/);
  assert.match(service, /incrementUserTrustScore\([\s\S]*session/);
  assert.match(service, /session\.abortTransaction\(\)/);
  assert.ok(commitIndex >= 0 && notificationIndex > commitIndex);
  assert.doesNotMatch(service, /Promise\.all\(\[\s*ratingRepository\.markItemRated/);
  assert.match(repository, /Rating\.create\(\[payload\], \{ session \}\)/);
  assert.match(repository, /runValidators: true/);
});

test('التحقق من الهاتف يكتب الحقل الفعلي ويمنع تضارب الأرقام غير المحققة', () => {
  const source = read('repositories/phoneRepository.js');

  assert.match(source, /phoneVerified: true/);
  assert.match(source, /findOne\(\{ phone, phoneVerified: true \}\)/);
  assert.doesNotMatch(source, /isVerifiedPhone/);
});

test('تكامل Baileys يستخدم API الصحيح وينظف الرقم الأردني', () => {
  const source = read('integrations/baileys.js');

  assert.equal(baileys._private.cleanPhone('07 9000-0001'), '962790000001');
  assert.equal(baileys._private.cleanPhone('+962-79-000-0001'), '962790000001');
  assert.match(source, /sock\.sendMessage\(/);
  assert.doesNotMatch(source, /send_message/);
  assert.doesNotMatch(source, /\$\{PLATFORM_NAME\}/);
});

test('WhatsApp Cloud يحترم مفتاح التعطيل والرابط المضبوط', (t) => {
  const previous = {
    enabled: process.env.WHATSAPP_ENABLED,
    token: process.env.WHATSAPP_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_ID,
    apiUrl: process.env.WHATSAPP_API_URL,
  };
  t.after(() => {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('WHATSAPP_ENABLED', previous.enabled);
    restore('WHATSAPP_TOKEN', previous.token);
    restore('WHATSAPP_PHONE_ID', previous.phoneId);
    restore('WHATSAPP_API_URL', previous.apiUrl);
  });

  process.env.WHATSAPP_ENABLED = 'false';
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_ID = '12345';
  process.env.WHATSAPP_API_URL = 'https://graph.example/{PHONE_NUMBER_ID}/messages';

  assert.deepEqual(whatsappService._private.getConfig(), {
    enabled: false,
    accessToken: 'test-token',
    apiUrl: 'https://graph.example/12345/messages',
  });

  delete process.env.WHATSAPP_PHONE_ID;
  assert.equal(whatsappService._private.getConfig().apiUrl, '');
});

test('إرسال البريد يملك مهلة تمنع تعليق الطلب بلا نهاية', () => {
  const source = read('utils/sendEmail.js');

  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /clearTimeout\(timeoutId\)/);
});
