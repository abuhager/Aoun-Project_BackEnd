// middlewares/errorHandler.js
module.exports = (err, _req, res, _next) => {
  const isDev = process.env.NODE_ENV !== 'production';

  console.error('[Error]', err.message);
  if (isDev && err.stack) {
    console.error(err.stack);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] ?? 'حقل';
    return res.status(409).json({
      msg: `${field} مستخدم مسبقاً`,
      code: 'DUPLICATE_KEY',
    });
  }

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(422).json({
      msg: 'بيانات غير صالحة',
      errors,
      code: 'VALIDATION_ERROR',
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      msg: 'معرّف غير صحيح',
      code: 'INVALID_ID',
    });
  }

  if (err.message?.includes('CORS')) {
    return res.status(403).json({
      msg: err.message,
      code: 'CORS_BLOCKED',
    });
  }

  return res.status(err.status || err.statusCode || 500).json({
    msg: isDev ? err.message : 'حدث خطأ داخلي في الخادم 🛠️',
    code: err.code || 'SERVER_ERROR',
    ...(isDev && err.details ? { details: err.details } : {}),
  });
};