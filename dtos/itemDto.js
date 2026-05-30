// backend/dtos/itemDto.js
const Joi = require('joi');
const SystemSettings = require('../models/SystemSettings');

// ============================================
// 1. Validation
// ============================================

exports.validateCreateItem = async (data) => {
  // جلب الإعدادات الديناميكية
  const settings = await SystemSettings.getCached(); // استخدم الـ cache الموجود
  const validCategories = settings.categories;

  const schema = Joi.object({
    title: Joi.string().min(3).max(100).required().messages({
      'string.empty': 'العنوان مطلوب',
      'string.min': 'اسم الغرض يجب أن يكون 3 أحرف على الأقل',
    }),
    // ✅ الآن التصنيفات ديناميكية من قاعدة البيانات
    category: Joi.string()
      .valid(...validCategories)
      .required()
      .messages({
        'string.empty': 'التصنيف مطلوب',
        'any.only': `التصنيف غير صحيح. المتاح: ${validCategories.join(', ')}`,
      }),
    safeHub: Joi.string().hex().length(24).required().messages({
      'string.empty': 'مركز التسليم مطلوب',
    }),
    description: Joi.string().allow('').max(500),
  });

  return schema.validateAsync(data, { abortEarly: false });
};


exports.validateUpdateItem = async (data) => {
  // جلب الإعدادات الديناميكية
  const settings = await SystemSettings.getCached();
  const validCategories = settings.categories;

  const schema = Joi.object({
    title:       Joi.string().min(3).max(100),
    category:    Joi.string().valid(...validCategories),
    description: Joi.string().allow('').max(500),
    location:    Joi.string(),
    condition:   Joi.string().allow('').max(100),
    // ✅ إضافة safeHub في التعديل أيضاً
    safeHub: Joi.string().hex().length(24).optional().allow('', null).messages({
      'string.length': 'معرّف المركز غير صحيح',
    }),
  }).unknown(true);
  return schema.validateAsync(data, { abortEarly: false });
};

// ============================================
// 2. Transformations
// ============================================

exports.toPublicItem = (item) => ({
  _id:           item._id,
  title:         item.title,
  description:   item.description,
  category:      item.category,
  location:      item.location,
  condition:     item.condition,
  imageUrl:      item.imageUrl,
  status:        item.status,
  reportCount:   item.reportCount,
  waitlistCount: item.waitlist?.length ?? 0,
  bookedAt:      item.bookedAt,
  isRated:       item.isRated,
  handoverMode:  item.handoverMode,
  // ✅ safeHub بدل hubId — يتطابق مع اسم الحقل في الـ Model
  safeHub: item.safeHub ? {
    _id:          item.safeHub._id,
    name:         item.safeHub.name,
    address:      item.safeHub.address,
    city:         item.safeHub.city,
    workingHours: item.safeHub.workingHours,
  } : null,
  createdAt: item.createdAt,
  donor: item.donor ? {
    _id:               item.donor._id,
    name:              item.donor.name,
    trustScore:        item.donor.trustScore,
    avatar:            item.donor.avatar,
    isVerifiedStudent: item.donor.isVerifiedStudent,
  } : null,
  bookedBy: item.bookedBy ? {
    _id:  item.bookedBy._id,
    name: item.bookedBy.name,
  } : null,
});

// للمتبرع — يرى بيانات الحاجز (email + phone) بدون OTP
exports.toDonorItem = (item) => ({
  ...exports.toPublicItem(item),
  reportId: item.reportId ?? null, // ✅ جديد
  bookedBy: item.bookedBy ? {
    _id:   item.bookedBy._id,
    name:  item.bookedBy.name,
    phone: item.bookedBy.phone,
    email: item.bookedBy.email,
  } : null,
});

// للمستلم — يرى بيانات المتبرع (phone) بدون OTP
exports.toReceiverItem = (item) => ({
  ...exports.toPublicItem(item),
  donor: item.donor ? {
    _id:               item.donor._id,
    name:              item.donor.name,
    phone:             item.donor.phone,
    trustScore:        item.donor.trustScore,
    isVerifiedStudent: item.donor.isVerifiedStudent,
  } : null,
});