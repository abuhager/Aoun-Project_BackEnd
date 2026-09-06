const test = require('node:test');
const assert = require('node:assert/strict');

async function setup(t, responseFactory, production = false) {
  const { default: SystemSettings } = await import('../models/SystemSettings.ts');
  const { default: sendEmail } = await import('../utils/sendEmail.ts');
  const saved = { BREVO_API_KEY: process.env.BREVO_API_KEY, NODE_ENV: process.env.NODE_ENV };
  process.env.BREVO_API_KEY = 'test-only-api-key';
  process.env.NODE_ENV = production ? 'production' : 'test';
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(SystemSettings, 'getCached', async () => ({ platformName: 'عون' }));
  const entries = [];
  for (const method of ['error', 'info', 'warn', 'log']) {
    t.mock.method(console, method, (...args) => entries.push(args));
  }
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return responseFactory();
  });
  const options = {
    email: 'private-recipient@example.test',
    subject: 'private-subject',
    message: '<p>private-reset-token</p>',
    replyTo: 'private-reply@example.test',
  };
  await sendEmail(options);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload.to, [{ email: options.email }]);
  assert.equal(payload.subject, options.subject);
  assert.equal(payload.htmlContent, options.message);
  assert.equal(payload.replyTo.email, options.replyTo);
  const output = JSON.stringify(entries);
  for (const secret of [...Object.values(options), 'private-reset-token', 'test-only-api-key']) {
    assert.ok(!output.includes(secret), 'Logs must not contain recipient, subject, message or credentials');
  }
  return { entries, output };
}

test('سجل فشل البريد يحتفظ بالحالة دون بيانات المستلم أو رد Brevo الخام', async (t) => {
  const { output } = await setup(t, () => Response.json({
    message: 'private-recipient@example.test private-subject private-reset-token',
  }, { status: 401 }));
  assert.match(output, /401/);
});

test('أخطاء اتصال البريد لا تسرّب رسالة الشبكة أو بيانات الاعتماد', async (t) => {
  const { output } = await setup(t, () => {
    throw new Error('private-recipient@example.test test-only-api-key private-reset-token');
  });
  assert.match(output, /تعذر الاتصال/);
});

test('نجاح البريد في production لا يسجل معلومات الرسالة', async (t) => {
  const { entries } = await setup(t, () => Response.json({ messageId: 'private-message-id' }, { status: 201 }), true);
  assert.deepEqual(entries, []);
});
