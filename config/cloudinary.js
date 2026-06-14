// config/cloudinary.js — بدون تغيير وظيفي (الملف صحيح)
// ✅ فقط تنظيف BOM character الموجود في بداية الملف الأصلي (U+FEFF)
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

module.exports = cloudinary;
