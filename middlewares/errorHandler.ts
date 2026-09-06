import AppError from '../utils/AppError.js';
import { buildErrorResponse } from '../utils/errorResponse.js';
import multer from 'multer';
import type { ErrorRequestHandler } from 'express';

type ErrorLike = Error & {
  code?: string | number;
  path?: string;
  status?: number;
};

const asErrorLike = (error: unknown): ErrorLike => {
  if (error instanceof Error) return error as ErrorLike;
  return Object.assign(new Error(String(error)), { originalError: error });
};

const normalizeMongo = (input: unknown): ErrorLike => {
  const err = asErrorLike(input);
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

const normalizeUpload = (input: unknown): ErrorLike => {
  const err = asErrorLike(input);
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

const normalizeCors = (input: unknown): ErrorLike => {
  const err = asErrorLike(input);
  if (err.code === 'CORS_ORIGIN_DENIED' || err.code === 'CORS_MISCONFIGURED') {
    return AppError.fromStatus(err.status || 403, err.message, err.code);
  }
  return err;
};

// eslint-disable-next-line no-unused-vars
const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    const originalError = asErrorLike(err);
    console.error(
      `[errorHandler][Request-ID: ${req.id || 'N/A'}] Headers أُرسلت مسبقاً:`,
      originalError.message
    );
    return next(originalError);
  }

  let error: ErrorLike = normalizeMongo(err);
  error = normalizeCors(error);
  error = normalizeUpload(error);

  const rawRequestId = req.id || req.headers['x-request-id'];
  const requestId = Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId;
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

export default errorHandler;
