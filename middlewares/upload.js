// middlewares/upload.js ✅ مصحّح — فحص Magic Bytes
const multer = require('multer');
const AppError = require('../utils/AppError');
const {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} = require('../utils/imageValidation');

/**
 * يتحقق من Magic Bytes الفعلية للملف
 * @param {Buffer} buffer - محتوى الملف في الذاكرة
 * @param {string} mimetype - الـ mimetype المُعلَن
 * @returns {boolean}
 */
const verifyMagicBytes = (buffer, mimetype) => {
  if (!buffer || buffer.length < 4) return false;

  switch (mimetype) {
    case 'image/jpeg':
      // يبدأ بـ FF D8 FF
      return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

    case 'image/png':
      // يبدأ بـ 89 50 4E 47
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47
      );

    case 'image/webp':
      // RIFF في bytes 0-3 و WEBP في bytes 8-11
      if (buffer.length < 12) return false;
      return (
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      );

    default:
      return false;
  }
};

const fileFilter = (_req, file, cb) => {
  if (
    typeof file.originalname !== 'string'
    || Buffer.byteLength(file.originalname, 'utf8') > 255
    || /[\0\r\n]/.test(file.originalname)
  ) {
    return cb(
      new AppError('اسم الملف غير صالح', 400, 'INVALID_FILE_NAME'),
      false
    );
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    return cb(
      new AppError(
        'نوع الملف غير مدعوم — الصور المسموحة: JPEG, PNG, WEBP فقط',
        415,
        'INVALID_IMAGE_TYPE'
      ),
      false
    );
  }
  return cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
    fields: 12,
    parts: 13,
    fieldSize: 16 * 1024,
    fieldNameSize: 100,
  },
  fileFilter,
});

// ✅ Middleware إضافي يُستدعى بعد upload.single()
// يتحقق من Magic Bytes بعد تحميل الملف في الذاكرة
const verifyImageBuffer = (req, _res, next) => {
  if (!req.file) return next(); // لا ملف → تمرير للـ controller

  const { buffer, mimetype } = req.file;

  if (!verifyMagicBytes(buffer, mimetype)) {
    return next(new AppError(
      'محتوى الملف لا يتطابق مع نوعه المُعلَن 🚫',
      400,
      'INVALID_FILE_CONTENT'
    ));
  }

  return next();
};

module.exports = {
  fileFilter,
  upload,
  verifyImageBuffer,
  verifyMagicBytes,
};
