// middlewares/upload.js ✅ مصحّح — فحص Magic Bytes
const multer = require('multer');

const MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE_BYTES || String(5 * 1024 * 1024));

// Magic bytes للصور المسموحة فقط
// المصدر: https://en.wikipedia.org/wiki/List_of_file_signatures
const MAGIC_BYTES = {
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF],            // JPEG
  ],
  'image/jpg': [
    [0xFF, 0xD8, 0xFF],
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47],     // PNG: ‰PNG
  ],
  'image/webp': [
    // RIFF....WEBP
    null,                           // سنتحقق بطريقة مختلفة أدناه
  ],
};

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
    case 'image/jpg':
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

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const fileFilter = (_req, file, cb) => {
  // ✅ فحص أولي على الـ mimetype المُعلَن
  if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
    return cb(
      new Error('نوع الملف غير مدعوم — الصور المسموحة: JPEG, PNG, WEBP فقط'),
      false
    );
  }
  // ✅ الـ Magic Bytes سيُفحص في authService بعد رفع الملف للذاكرة
  // (multer يحتاج الـ buffer أولاً — نفحصه في الـ controller)
  cb(null, true);
};

const upload = multer({
  storage:    multer.memoryStorage(),
  limits:     { fileSize: MAX_SIZE, files: 1 },
  fileFilter,
});

// ✅ Middleware إضافي يُستدعى بعد upload.single()
// يتحقق من Magic Bytes بعد تحميل الملف في الذاكرة
const verifyImageBuffer = (req, res, next) => {
  if (!req.file) return next(); // لا ملف → تمرير للـ controller

  const { buffer, mimetype } = req.file;

  if (!verifyMagicBytes(buffer, mimetype)) {
    return res.status(400).json({
      msg:  'محتوى الملف لا يتطابق مع نوعه المُعلَن 🚫',
      code: 'INVALID_FILE_CONTENT',
    });
  }

  next();
};

module.exports = { upload, verifyImageBuffer };