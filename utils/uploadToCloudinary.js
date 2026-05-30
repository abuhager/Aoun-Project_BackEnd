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

module.exports = { uploadToCloudinary };