// middlewares/errorHandler.js — النسخة المصحّحة (Flow-1 Audit)
// ✅ إصلاح LOGIC-01: حماية من double res.send عبر res.headersSent
// ✅ إصلاح LOGIC-01: تغيير next → _next لإخبار ESLint أنه intentional unused param

const Joi      = require('joi');
const AppError = require('../utils/AppError');

const isProduction = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────
// normalizeError: يحوّل أي خطأ إلى AppError موحّد
// يُغطي: AppError | Joi | Mongoose Validation | CastError | Duplicate Key | JWT
// ─────────────────────────────────────────────────────────────
function normalizeError(err) {
  if (!err) {
    return new AppError('خطأ غير معروف في الخادم', 500, 'UNKNOWN_ERROR');
  }

  if (err instanceof AppError) return err;

  // Joi Validation
  if (err.isJoi || err instanceof Joi.ValidationError) {
    return new AppError(
      'بيانات غير صالحة',
      422,
      'VALIDATION_ERROR',
      err.details?.map((d) => d.message) || null
    );
  }

  // Mongoose Schema Validation
  if (err.name === 'ValidationError') {
    return new AppError(
      'فشل التحقق من البيانات',
      422,
      'MONGOOSE_VALIDATION_ERROR',
      Object.values(err.errors || {}).map((e) => e.message)
    );
  }

  // Mongoose CastError (ObjectId غير صالح)
  if (err.name === 'CastError') {
    return new AppError('معرّف أو قيمة غير صالحة', 400, 'INVALID_IDENTIFIER');
  }

  // MongoDB Duplicate Key
  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    return new AppError(
      `القيمة موجودة مسبقاً${fields.length ? `: ${fields.join(', ')}` : ''}`,
      409,
      'DUPLICATE_KEY'
    );
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return new AppError('رمز الدخول غير صالح', 401, 'INVALID_TOKEN');
  }
  if (err.name === 'TokenExpiredError') {
    return new AppError('انتهت صلاحية رمز الدخول', 401, 'TOKEN_EXPIRED');
  }

  // Fallback عام
  return new AppError(
    err.message || 'حدث خطأ داخلي في الخادم',
    err.statusCode || err.status || 500,
    err.code || 'SERVER_ERROR'
  );
}

// ─────────────────────────────────────────────────────────────
// errorHandler: يجب أن يكون آخر middleware في app.js دائماً
// Express يتعرف عليه كـ error handler بسبب الـ 4 parameters (err, req, res, next)
// ─────────────────────────────────────────────────────────────
function errorHandler(err, req, res, _next) {
  // ✅ LOGIC-01: guard ضد إرسال response مزدوج (يحدث عند connection timeout أو stream errors)
  if (res.headersSent) {
    console.warn('[errorHandler] تحذير: الـ headers أُرسلت مسبقاً، تم تجاهل الخطأ:', err?.message);
    return;
  }

  const normalized = normalizeError(err);

  // ── Logging ───────────────────────────────────────────────
  if (!isProduction) {
    // Development: تفاصيل كاملة في الـ console لتسريع الـ debugging
    console.error('❌ [Error]:', {
      message:    normalized.message,
      code:       normalized.code,
      statusCode: normalized.statusCode,
      stack:      err?.stack,
      path:       req.originalUrl,
      method:     req.method,
    });
  } else {
    // Production: سجّل الـ 5xx فقط — الـ 4xx توقّعية ولا تحتاج إلى تنبيه
    if (normalized.statusCode >= 500) {
      console.error(JSON.stringify({
        level:     'error',
        timestamp: new Date().toISOString(),
        message:   err?.message,
        code:      normalized.code,
        path:      req.originalUrl,
        method:    req.method,
        // Stack للـ monitoring الداخلي — لا يظهر في response
        stack:     err?.stack,
      }));
    }
  }

  // ── Response ──────────────────────────────────────────────
  const response = {
    msg:  normalized.message,
    code: normalized.code,
  };

  if (normalized.details) {
    response.errors = normalized.details;
  }

  // ✅ Stack trace في dev فقط — أبداً في production لمنع كشف البنية الداخلية
  if (!isProduction) {
    response.stack = err?.stack;
  }

  res.status(normalized.statusCode).json(response);
}

module.exports = errorHandler;
