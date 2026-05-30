// utils/AppError.js
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'SERVER_ERROR', details = null) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace?.(this, this.constructor);
  }
}

module.exports = AppError;