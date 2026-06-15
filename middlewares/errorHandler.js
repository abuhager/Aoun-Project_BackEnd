// middlewares/errorHandler.js — Flow 1 FINAL FIXED
// ✅ FIX-01: CastError، Duplicate Key، ValidationError تُحوَّل إلى AppError قبل الإرسال
// ✅ FIX-02: CORS error (err.code === 'CORS_*' أو err.status === 403) تُعالَج بشكل صريح
// ✅ FIX-03: stack trace يُرسَل في dev فقط — في production يُسجَّل فقط دون إرساله
// ✅ FIX-04: رسالة prod عامة للأخطاء غير العملياتية (لا تكشف تفاصيل الـ programmer error)
// ✅ FIX-05: headers المُرسَلة مسبقاً — لا إرسال مكرر يتسبب في crash

const AppError = require('../utils/AppError');

// ── حوِّل أخطاء Mongoose المعروفة إلى AppError ────────────────
const normalizeMongo = (err) => {
  // CastError — معرِّف MongoDB غير صالح
  if (err.name === 'CastError') {
    return new AppError(
      `قيمة غير صالحة للحقل "${err.path}": ${err.value}`,
      400,
      'INVALID_ID'
    );
  }

  // Duplicate Key — قيمة فريدة موجودة مسبقاً
  if (err.code === 11000) {
    const field  = Object.keys(err.keyValue ?? {})[0] ?? 'حقل';
    const value  = err.keyValue?.[field];
    const safeVal = typeof value === 'string' && value.length < 60 ? ` "${value}"` : '';
    return new AppError(
      `${field}${safeVal} مستخدم مسبقاً`,
      409,
      'DUPLICATE_KEY'
    );
  }

  // ValidationError — فشل validate() في Mongoose
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message).join(' | ');
    return new AppError(messages, 422, 'VALIDATION_ERROR');
  }

  return err; // لا تغيير
};

// ── ✅ FIX-02: أخطاء CORS ─────────────────────────────────────
const normalizeCors = (err) => {
  if (err.code === 'CORS_ORIGIN_DENIED' || err.code === 'CORS_MISCONFIGURED') {
    return new AppError(err.message, err.status || 403, err.code);
  }
  return err;
};

// ── الـ Error Handler الرئيسي ─────────────────────────────────
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // ✅ FIX-05: إذا أُرسلت الـ headers مسبقاً (stream أو نصف استجابة) — لا نُرسل مجدداً
  if (res.headersSent) {
    console.error('[errorHandler] Headers أُرسلت مسبقاً — تجاهل الخطأ:', err.message);
    return;
  }

  // ✅ تطبيق normalizers بالترتيب
  let error = normalizeMongo(err);
  error     = normalizeCors(error);

  // تحديد ما إذا كان AppError رسمياً
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : (error.status ?? 500);
  const isOperational = isAppError ? error.isOperational : false;

  // ✅ FIX-03: Stack trace — dev فقط
  if (process.env.NODE_ENV !== 'production') {
    console.error('🐛 [Error]:', error);
  } else {
    // ✅ FIX-04: في production نُسجِّل Programmer errors مع stack للـ debugging الخارجي
    if (!isOperational) {
      console.error('💥 [Programmer Error]:', {
        message:   error.message,
        stack:     error.stack,
        url:       req.originalUrl,
        method:    req.method,
        userId:    req.user?.id,
        requestId: req.headers['x-request-id'],
      });
    }
  }

  // ── بناء جسم الاستجابة ─────────────────────────────────────
  const body = {
    status:  statusCode >= 500 ? 'error' : 'fail',
    message: isOperational
      ? error.message
      // ✅ FIX-04: رسالة عامة للـ Programmer errors في production — لا كشف للتفاصيل
      : (process.env.NODE_ENV === 'production'
          ? 'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً.'
          : error.message),
    code:    isAppError ? error.code : undefined,
  };

  // ✅ FIX-03: stack في dev فقط
  if (process.env.NODE_ENV !== 'production' && error.stack) {
    body.stack = error.stack;
  }

  res.status(statusCode).json(body);
};

module.exports = errorHandler;
