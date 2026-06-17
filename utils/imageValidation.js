// utils/imageValidation.js ✅ NEW [ARCH-01]
// مصدر واحد للحقيقة — يُستخدم في itemService + donationRequestService + middleware/upload
const AppError = require('./AppError');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE      = 5 * 1024 * 1024; // 5MB

/**
 * يتحقق من نوع وحجم ملف الصورة
 * @param {Express.Multer.File} file
 * @param {object} opts — { required: boolean }
 */
const validateImageFile = (file, { required = false } = {}) => {
  if (!file) {
    if (required) throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
    return;
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype))
    throw new AppError('نوع الصورة غير مدعوم (JPEG/PNG/WebP فقط)', 400, 'INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_SIZE)
    throw new AppError('حجم الصورة يتجاوز 5MB', 400, 'IMAGE_TOO_LARGE');
};

module.exports = { validateImageFile, ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE };