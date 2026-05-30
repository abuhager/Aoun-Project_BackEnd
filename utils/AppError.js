class AppError extends Error {
  constructor(message, statusCode = 500, code = 'SERVER_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.status = statusCode;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

module.exports = AppError;