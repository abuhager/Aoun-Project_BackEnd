// middlewares/errorHandler.js
const Joi = require('joi');
const AppError = require('../utils/AppError');

const isProduction = process.env.NODE_ENV === 'production';

function normalizeError(err) {
  if (!err) {
    return new AppError('خطأ غير معروف في الخادم', 500, 'UNKNOWN_ERROR');
  }

  if (err instanceof AppError) {
    return err;
  }

  if (err.isJoi || err instanceof Joi.ValidationError) {
    return new AppError(
      'بيانات غير صالحة',
      422,
      'VALIDATION_ERROR',
      err.details?.map((d) => d.message) || null
    );
  }

  if (err.name === 'ValidationError') {
    return new AppError(
      'فشل التحقق من البيانات',
      422,
      'MONGOOSE_VALIDATION_ERROR',
      Object.values(err.errors || {}).map((e) => e.message)
    );
  }

  if (err.name === 'CastError') {
    return new AppError(
      'معرّف أو قيمة غير صالحة',
      400,
      'INVALID_IDENTIFIER'
    );
  }

  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    return new AppError(
      `القيمة موجودة مسبقاً${fields.length ? `: ${fields.join(', ')}` : ''}`,
      409,
      'DUPLICATE_KEY'
    );
  }

  if (err.name === 'JsonWebTokenError') {
    return new AppError('رمز الدخول غير صالح', 401, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    return new AppError('انتهت صلاحية رمز الدخول', 401, 'TOKEN_EXPIRED');
  }

  return new AppError(
    err.message || 'حدث خطأ داخلي في الخادم',
    err.statusCode || err.status || 500,
    err.code || 'SERVER_ERROR'
  );
}

function errorHandler(err, req, res, next) {
  const normalized = normalizeError(err);

  if (!isProduction) {
    console.error('❌ Error:', {
      message: normalized.message,
      code: normalized.code,
      statusCode: normalized.statusCode,
      stack: err?.stack,
      path: req.originalUrl,
      method: req.method,
    });
  }

  const response = {
    msg: normalized.message,
    code: normalized.code,
  };

  if (normalized.details) {
    response.errors = normalized.details;
  }

  if (!isProduction) {
    response.stack = err?.stack;
  }

  res.status(normalized.statusCode).json(response);
}

module.exports = errorHandler;