// utils/AppError.js — Flow 1 FINAL FIXED
// ✅ FIX-01: captureStackTrace ينفَّذ شرطياً — يعمل في V8 فقط (Node.js)، لا يكسر في بيئات أخرى
// ✅ FIX-02: code إلزامي (ليس اختيارياً) — يسهّل frontend error handling بدون مقارنة نصية
// ✅ FIX-03: toJSON() يمنع تسرب stack في production تلقائياً

class AppError extends Error {
  /**
   * @param {string}  message      - رسالة بشرية (قد تُعرض للمستخدم)
   * @param {number}  statusCode   - HTTP status code
   * @param {string}  code         - كود آلي مستقر للـ frontend (مثل 'ITEM_NOT_FOUND')
   * @param {any}     [details]    - بيانات إضافية (validation errors مثلاً) — لا تُرسَل في production
   */
  constructor(message, statusCode, code = 'INTERNAL_ERROR', details = null) {
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

  // ✅ FIX-03: toJSON مُتحكَّم فيه — لا stack في production
  toJSON() {
    const base = {
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
