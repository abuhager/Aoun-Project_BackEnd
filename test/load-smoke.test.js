const test = require('node:test');
const assert = require('node:assert/strict');

// Dynamic import executes this module as ESM (including its CLI guard).
const loadTools = import('../scripts/load-smoke.ts');

test('فحص الحمل يرفض خادمًا خارجيًا دون تأكيد ويمنع أسرار URL والضغط غير المحدود', async () => {
  const { readLoadConfig } = await loadTools;
  assert.equal(readLoadConfig({}).origin, 'http://127.0.0.1:5000');
  assert.throws(() => readLoadConfig({ LOAD_TEST_BASE_URL: 'https://demo.example' }), /CONFIRM_ORIGIN/);
  assert.throws(() => readLoadConfig({ LOAD_TEST_BASE_URL: 'https://name:secret@demo.example' }), /أسرار/);
  assert.throws(() => readLoadConfig({ LOAD_TEST_STAGES: '5,1' }), /متزايدة/);
  assert.throws(() => readLoadConfig({ LOAD_TEST_STAGES: '31' }));
  assert.throws(() => readLoadConfig({ LOAD_TEST_SCENARIO: '/api/auth/login' }));
  assert.throws(() => readLoadConfig({ LOAD_TEST_ROUNDS: '5' }), /100/);
});

test('فحص الحمل يقيس GET فعليًا ويعرض عدد الطلبات دون اختراع عدد مستخدمين', async () => {
  const { readLoadConfig, runLoadSmoke } = await loadTools;
  let running = 0;
  let maxRunning = 0;
  let calls = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(url, 'http://127.0.0.1:5000/api/items?page=1&limit=12');
    calls += 1;
    maxRunning = Math.max(maxRunning, ++running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return Response.json({ items: [] });
  };
  const result = await runLoadSmoke(readLoadConfig({ LOAD_TEST_STAGES: '1,3', LOAD_TEST_ROUNDS: '1' }), fetcher);
  assert.equal(calls, 5);
  assert.equal(maxRunning, 3);
  assert.equal(result.stages[1].successful, 3);
  assert.equal(result.maximumUsers, null);
  assert.equal(result.stopReason, null);
});

test('فحص الحمل يتوقف بعد 429 أو 5xx أو بيانات غير مطابقة ولا يتجاوز الحماية', async () => {
  const { readLoadConfig, runLoadSmoke } = await loadTools;
  for (const [response, expected] of [
    [new Response('', { status: 429, headers: { 'Retry-After': '60' } }), 'rate_limited'],
    [new Response('', { status: 503 }), 'request_failed'],
    [Response.json({ page: 'login' }), 'request_failed'],
  ]) {
    let calls = 0;
    const result = await runLoadSmoke(readLoadConfig({}), async () => {
      calls += 1;
      return response;
    });
    assert.equal(calls, 1);
    assert.equal(result.stopReason, expected);
    assert.deepEqual(result.stages, []);
  }
});

test('فحص الحمل يحترم مهلة الاتصال', async () => {
  const { readLoadConfig, runLoadSmoke } = await loadTools;
  const result = await runLoadSmoke(readLoadConfig({ LOAD_TEST_TIMEOUT_MS: '10' }), (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))))
  );
  assert.equal(result.stopReason, 'request_failed');
  assert.equal(result.warmup.status, 0);
});

test('إلغاء المستخدم يوقف الفحص ولا يبدأ مرحلة لاحقة', async () => {
  const { readLoadConfig, runLoadSmoke } = await loadTools;
  const controller = new AbortController();
  let calls = 0;
  const result = await runLoadSmoke(readLoadConfig({}), async (_url, { signal }) => {
    calls += 1;
    controller.abort();
    signal.throwIfAborted();
    return Response.json({ items: [] });
  }, controller.signal);
  assert.equal(result.stopReason, 'interrupted');
  assert.equal(calls, 1);
  assert.deepEqual(result.stages, []);
});

test('ظهور 429 داخل مرحلة يوقف الجولات والمراحل التالية', async () => {
  const { readLoadConfig, runLoadSmoke } = await loadTools;
  let calls = 0;
  const result = await runLoadSmoke(readLoadConfig({}), async () => {
    calls += 1;
    return calls === 1 ? Response.json({ items: [] }) : new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  });
  assert.equal(result.stopReason, 'rate_limited');
  assert.equal(calls, 2);
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].failed, 1);
  assert.equal(result.stages[0].retryAfter, '60');
});

test('تجاوز عتبة التأخير يوقف رفع التزامن', async () => {
  const { readLoadConfig, runLoadSmoke } = await loadTools;
  let calls = 0;
  const result = await runLoadSmoke(readLoadConfig({ LOAD_TEST_MAX_P95_MS: '1' }), async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ items: [] });
  });
  assert.equal(result.stopReason, 'latency_threshold');
  assert.equal(calls, 2);
  assert.equal(result.stages.length, 1);
});

test('حساب p95 لا يسجل الطلبات الفاشلة كنجاح', async () => {
  const { summarizeSamples } = await loadTools;
  const rows = [10, 20, 30, 100].map((durationMs, index) => ({
    durationMs, status: index === 3 ? 429 : 200, valid: index !== 3, retryAfter: null,
  }));
  const summary = summarizeSamples(rows, 1000);
  assert.equal(summary.p95Ms, 100);
  assert.equal(summary.successful, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.observedRequestsPerSecond, 3);
});
