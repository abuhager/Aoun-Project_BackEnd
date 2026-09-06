import cloudinary from '../config/cloudinary.js';
import type { UploadApiErrorResponse, UploadApiResponse } from 'cloudinary';

const uploadToCloudinary = (buffer: Buffer, folder = 'aoun-items') =>
  new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Cloudinary did not return an upload result'));
        resolve(result);
      }
    );
    stream.end(buffer);
  });

// ✅ [CRIT-4] دالة حذف الصورة القديمة من Cloudinary عند تعديل الغرض
const deleteFromCloudinary = (publicId: string) =>
  cloudinary.uploader.destroy(publicId);

export { uploadToCloudinary, deleteFromCloudinary };
export default { uploadToCloudinary, deleteFromCloudinary };
