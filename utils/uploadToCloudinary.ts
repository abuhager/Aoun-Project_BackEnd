// utils/uploadToCloudinary.js
const cloudinary = require('../config/cloudinary');

const uploadToCloudinary = (buffer, folder = 'aoun-items') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });

// ✅ [CRIT-4] دالة حذف الصورة القديمة من Cloudinary عند تعديل الغرض
const deleteFromCloudinary = (publicId) =>
  cloudinary.uploader.destroy(publicId);

module.exports = { uploadToCloudinary, deleteFromCloudinary };