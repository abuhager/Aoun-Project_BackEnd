const test = require('node:test');
const assert = require('node:assert/strict');

const AppError = require('../utils/AppError').default;
const asyncHandler = require('../utils/asyncHandler').default;
const {
  INTERNAL_ERROR_MESSAGE,
  buildErrorResponse,
} = require('../utils/errorResponse');

test('مصانع AppError تثبّت status وcode وdetails', () => {
  const error = AppError.unprocessableEntity(
    'تحقق من الحقول',
    'INVALID_FORM',
    { field: 'email' }
  );

  assert.equal(error.statusCode, 422);
  assert.equal(error.code, 'INVALID_FORM');
  assert.deepEqual(error.details, { field: 'email' });
  assert.equal(error.isOperational, true);
});

test('عقد الخطأ يحافظ على message وmsg وrequestId للواجهة', () => {
  const error = AppError.conflict('موجود مسبقاً', 'ALREADY_EXISTS');
  const result = buildErrorResponse(error, {
    requestId: 'req-flow-16',
    isProduction: true,
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.isOperational, true);
  assert.deepEqual(result.body, {
    status: 'fail',
    message: 'موجود مسبقاً',
    msg: 'موجود مسبقاً',
    code: 'ALREADY_EXISTS',
    requestId: 'req-flow-16',
  });
});

test('production لا يسرّب رسالة أو stack لأخطاء البرمجة و5xx', () => {
  const programmerError = new Error('database password leaked');
  const programmerResult = buildErrorResponse(programmerError, {
    requestId: 'req-private',
    isProduction: true,
  });
  const operational5xx = buildErrorResponse(
    AppError.internal('تفاصيل داخلية', 'UPSTREAM_FAILURE'),
    { isProduction: true }
  );

  assert.equal(programmerResult.statusCode, 500);
  assert.equal(programmerResult.body.message, INTERNAL_ERROR_MESSAGE);
  assert.equal(programmerResult.body.msg, INTERNAL_ERROR_MESSAGE);
  assert.equal('stack' in programmerResult.body, false);
  assert.equal(operational5xx.body.message, INTERNAL_ERROR_MESSAGE);
});

test('development يحتفظ بالرسالة وstack للتشخيص', () => {
  const error = new Error('تفاصيل للمطور');
  const result = buildErrorResponse(error, {
    requestId: 'req-dev',
    isProduction: false,
  });

  assert.equal(result.body.message, 'تفاصيل للمطور');
  assert.equal(result.body.requestId, 'req-dev');
  assert.match(result.body.stack, /تفاصيل للمطور/);
});

test('asyncHandler يمرر الرفض إلى next مرة واحدة', async () => {
  const expected = new Error('async failure');
  let calls = 0;

  await new Promise((resolve, reject) => {
    const next = (error) => {
      try {
        calls += 1;
        assert.equal(error, expected);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    };

    asyncHandler(async () => {
      throw expected;
    })({}, {}, next);
  });

  assert.equal(calls, 1);
});
