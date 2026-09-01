// utils/AppError.js — Flow 1 FINAL FIXED
// ✅ FIX-01: captureStackTrace ينفَّذ شرطياً — يعمل في V8 فقط (Node.js)، لا يكسر في بيئات أخرى
// ✅ FIX-02: code إلزامي (ليس اختيارياً) — يسهّل frontend error handling بدون مقارنة نصية
// ✅ FIX-03: toJSON() يمنع تسرب stack في production تلقائياً

class AppError extends Error {
  statusCode: number;
  code: string;
  details: unknown;
  isOperational: boolean;

  /**
   * @param {string}  message      - رسالة بشرية (قد تُعرض للمستخدم)
   * @param {number}  statusCode   - HTTP status code
   * @param {string}  code         - كود آلي مستقر للـ frontend (مثل 'ITEM_NOT_FOUND')
   * @param {any}     [details]    - بيانات إضافية (validation errors مثلاً) — لا تُرسَل في production
   */
  constructor(
    message: string,
    statusCode: number,
    code = 'INTERNAL_ERROR',
    details: unknown = null
  ) {
    super(message);

    this.statusCode    = statusCode;
    this.code          = code;
    this.details       = details;
    this.isOperational = true;
    this.name          = 'AppError';

    // ✅ FIX-01: شرطي — يعمل في V8/Node.js فقط
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AppError);
    }
  }

  // Flow 16: مصانع موحّدة تمنع تكرار status/code وترتيب معاملات المنشئ.
  static fromStatus(statusCode: number, message: string, code = 'INTERNAL_ERROR', details: unknown = null) {
    return new AppError(message, statusCode, code, details);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details: unknown = null) {
    return AppError.fromStatus(400, message, code, details);
  }

  static unauthorized(message: string, code = 'UNAUTHORIZED', details: unknown = null) {
    return AppError.fromStatus(401, message, code, details);
  }

  static forbidden(message: string, code = 'FORBIDDEN', details: unknown = null) {
    return AppError.fromStatus(403, message, code, details);
  }

  static notFound(message: string, code = 'NOT_FOUND', details: unknown = null) {
    return AppError.fromStatus(404, message, code, details);
  }

  static conflict(message: string, code = 'CONFLICT', details: unknown = null) {
    return AppError.fromStatus(409, message, code, details);
  }

  static payloadTooLarge(message: string, code = 'PAYLOAD_TOO_LARGE', details: unknown = null) {
    return AppError.fromStatus(413, message, code, details);
  }

  static unprocessableEntity(message: string, code = 'VALIDATION_ERROR', details: unknown = null) {
    return AppError.fromStatus(422, message, code, details);
  }

  static internal(message = 'حدث خطأ داخلي في الخادم', code = 'INTERNAL_ERROR', details: unknown = null) {
    return AppError.fromStatus(500, message, code, details);
  }

  // ✅ FIX-03: toJSON مُتحكَّم فيه — لا stack في production
  toJSON() {
    const base: {
      status: string;
      message: string;
      code: string;
      details?: unknown;
      stack?: string;
    } = {
      status:  this.statusCode >= 500 ? 'error' : 'fail',
      message: this.message,
      code:    this.code,
    };

    if (process.env.NODE_ENV !== 'production') {
      base.details = this.details;
      base.stack   = this.stack;
    }

    return base;
  }
}

module.exports = AppError;
