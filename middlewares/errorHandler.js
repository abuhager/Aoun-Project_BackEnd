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
    console.error(`[errorHandler][Request-ID: ${req.id || 'N/A'}] Headers أُرسلت مسبقاً:`, err.message);
    return next(err);
  }

  // ✅ تطبيق normalizers بالترتيب
  let error = normalizeMongo(err);
  error     = normalizeCors(error);

  // تحديد ما إذا كان AppError رسمياً
  const isAppError  = error instanceof AppError;
  const requestedStatus = isAppError ? error.statusCode : error.status;
  const statusCode = Number.isInteger(requestedStatus)
    && requestedStatus >= 400
    && requestedStatus <= 599
    ? requestedStatus
    : 500;
  const isOperational = isAppError ? error.isOperational : false;
  
  // استخلاص الـ Request ID الموحد الذي تم إنشاؤه في app.js
  const requestId   = req.id || req.headers['x-request-id'];

  // ✅ FIX-03: Stack trace — dev فقط
  if (process.env.NODE_ENV !== 'production') {
    console.error(`🐛 [Error][ID: ${requestId || 'N/A'}]:`, error);
  } else {
    // ✅ FIX-04: في production نُسجِّل الـ Programmer errors بدقة للـ debugging الخارجي
    if (!isOperational) {
      console.error('💥 [Programmer Error]:', {
        requestId,
        message:   error.message,
        stack:     error.stack,
        url:       req.originalUrl,
        method:    req.method,
        userId:    req.user?.id || req.user?._id,
      });
    }
  }

  // ── بناء جسم الاستجابة ─────────────────────────────────────
  const body = {
    status:  statusCode >= 500 ? 'error' : 'fail',
    message: isOperational && statusCode < 500
      ? error.message
      // ✅ FIX-04: رسالة عامة للـ Programmer errors في production — لا كشف للتفاصيل التقنية
      : (process.env.NODE_ENV === 'production'
          ? 'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً.'
          : error.message),
    code:      isAppError ? error.code : (error.code || 'INTERNAL_SERVER_ERROR'),
    requestId: requestId, // 💡 إرسال الـ ID للـ Frontend لربط التذاكر وبلاغات الأعطال بسجلات الخادم فوراُ
  };
  body.msg = body.message;

  // ✅ FIX-03: stack في dev فقط
  if (process.env.NODE_ENV !== 'production' && error.stack) {
    body.stack = error.stack;
  }

  res.status(statusCode).json(body);
};

module.exports = errorHandler;
