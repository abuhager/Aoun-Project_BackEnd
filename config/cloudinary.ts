import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

// ✅ سيتوقف server.ts عند الـ REQUIRED_ENV check قبل هذا
// لكن نضيف guard إضافي للـ fail-fast في حال استُدعي الملف منفرداً
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  throw new Error('[Cloudinary] متغيرات البيئة المطلوبة غير موجودة');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure:     true,
});

export default cloudinary;
