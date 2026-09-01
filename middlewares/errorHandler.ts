const AppError = require('../utils/AppError');
const { buildErrorResponse } = require('../utils/errorResponse');
const multer = require('multer');

const normalizeMongo = (err) => {
  if (err.name === 'CastError') {
    return AppError.badRequest(
      `قيمة غير صالحة للحقل "${err.path}"`,
      'INVALID_ID'
    );
  }

  if (err.code === 11000) {
    return AppError.conflict(
      'إحدى القيم الفريدة مستخدمة مسبقاً',
      'DUPLICATE_KEY'
    );
  }

  if (err.name === 'ValidationError') {
    return AppError.unprocessableEntity(
      'بيانات غير صالحة',
      'VALIDATION_ERROR'
    );
  }

  return err;
};

const normalizeUpload = (err) => {
  if (!(err instanceof multer.MulterError)) return err;

  if (err.code === 'LIMIT_FILE_SIZE') {
    return AppError.payloadTooLarge(
      'حجم الصورة يتجاوز الحد المسموح',
      'IMAGE_TOO_LARGE'
    );
  }

  return AppError.badRequest(
    'بيانات رفع الملف تتجاوز الحدود المسموحة',
    'UPLOAD_LIMIT_EXCEEDED'
  );
};

const normalizeCors = (err) => {
  if (err.code === 'CORS_ORIGIN_DENIED' || err.code === 'CORS_MISCONFIGURED') {
    return AppError.fromStatus(err.status || 403, err.message, err.code);
  }
  return err;
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    console.error(
      `[errorHandler][Request-ID: ${req.id || 'N/A'}] Headers أُرسلت مسبقاً:`,
      err.message
    );
    return next(err);
  }

  let error = normalizeMongo(err);
  error = normalizeCors(error);
  error = normalizeUpload(error);

  const requestId = req.id || req.headers['x-request-id'];
  const { statusCode, isOperational, body } = buildErrorResponse(error, {
    requestId,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.error(`🐛 [Error][ID: ${requestId || 'N/A'}]:`, error);
  } else if (!isOperational) {
    console.error('💥 [Programmer Error]:', {
      requestId,
      message: error.message,
      stack: error.stack,
      url: req.path || req.originalUrl?.split('?')[0],
      method: req.method,
      userId: req.user?.id || req.user?._id,
    });
  }

  return res.status(statusCode).json(body);
};

module.exports = errorHandler;
