// utils/imageValidation.js ✅ NEW [ARCH-01]
// مصدر واحد للحقيقة — يُستخدم في itemService + donationRequestService + middleware/upload
const AppError = require('./AppError');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MIN_IMAGE_SIZE_LIMIT = 64 * 1024;
const MAX_IMAGE_SIZE_LIMIT = 10 * 1024 * 1024;

const resolveMaxImageSize = (value = process.env.UPLOAD_MAX_SIZE_BYTES) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_IMAGE_SIZE_LIMIT
    || parsed > MAX_IMAGE_SIZE_LIMIT
  ) {
    return DEFAULT_MAX_IMAGE_SIZE;
  }
  return parsed;
};

const MAX_IMAGE_SIZE = resolveMaxImageSize();

/**
 * يتحقق من نوع وحجم ملف الصورة
 * @param {Express.Multer.File} file
 * @param {object} opts — { required: boolean }
 */
const validateImageFile = (
  file: Express.Multer.File | undefined,
  { required = false }: { required?: boolean } = {}
): void => {
  if (!file) {
    if (required) throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
    return;
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype))
    throw new AppError('نوع الصورة غير مدعوم (JPEG/PNG/WebP فقط)', 400, 'INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_SIZE)
    throw new AppError(
      `حجم الصورة يتجاوز الحد المسموح (${Math.floor(MAX_IMAGE_SIZE / 1024 / 1024)}MB)`,
      413,
      'IMAGE_TOO_LARGE'
    );
};

module.exports = {
  validateImageFile,
  ALLOWED_IMAGE_TYPES,
  DEFAULT_MAX_IMAGE_SIZE,
  MAX_IMAGE_SIZE,
  MAX_IMAGE_SIZE_LIMIT,
  MIN_IMAGE_SIZE_LIMIT,
  resolveMaxImageSize,
};
