import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import type { FileFilterCallback } from 'multer';
import AppError from '../utils/AppError.js';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE } from '../utils/imageValidation.js';

/**
 * يتحقق من Magic Bytes الفعلية للملف
 * @param {Buffer} buffer - محتوى الملف في الذاكرة
 * @param {string} mimetype - الـ mimetype المُعلَن
 * @returns {boolean}
 */
const verifyMagicBytes = (buffer: Buffer, mimetype: string): boolean => {
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

const rejectFile = (cb: FileFilterCallback, error: Error): void => {
  const callback = cb as unknown as (callbackError: Error, accepted: boolean) => void;
  callback(error, false);
};

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (
    typeof file.originalname !== 'string'
    || Buffer.byteLength(file.originalname, 'utf8') > 255
    || /[\0\r\n]/.test(file.originalname)
  ) {
    return rejectFile(cb, new AppError('اسم الملف غير صالح', 400, 'INVALID_FILE_NAME'));
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    return rejectFile(cb, new AppError(
      'نوع الملف غير مدعوم — الصور المسموحة: JPEG, PNG, WEBP فقط',
      415,
      'INVALID_IMAGE_TYPE'
    ));
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
const verifyImageBuffer = (req: Request, _res: Response, next: NextFunction) => {
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

export { fileFilter, upload, verifyImageBuffer, verifyMagicBytes };
export default {
  fileFilter,
  upload,
  verifyImageBuffer,
  verifyMagicBytes,
};
