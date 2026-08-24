// backend/dtos/itemDto.js
// ✅ FIX [UX-02]: toPublicItem يقبل requesterId ويُرجع isInWaitlist
const Joi            = require('joi');
const SystemSettings = require('../models/SystemSettings');


// ============================================
// 1. Validation
// ============================================


exports.validateCreateItem = async (data) => {
  const settings        = await SystemSettings.getCached();
  const validCategories = settings.categories;

  const schema = Joi.object({
    title: Joi.string().min(3).max(100).required().messages({
      'string.empty': 'العنوان مطلوب',
      'string.min':   'اسم الغرض يجب أن يكون 3 أحرف على الأقل',
    }),
    category: Joi.string()
      .valid(...validCategories)
      .required()
      .messages({
        'string.empty': 'التصنيف مطلوب',
        'any.only':     `التصنيف غير صحيح. المتاح: ${validCategories.join(', ')}`,
      }),
    safeHub: Joi.string().hex().length(24).optional().allow('', null).messages({
      'string.length': 'معرّف المركز غير صحيح',
    }),
    description: Joi.string().allow('').max(500),
  });

  return schema.validateAsync(data, { abortEarly: false });
};


exports.validateUpdateItem = async (data) => {
  const settings        = await SystemSettings.getCached();
  const validCategories = settings.categories;

  const schema = Joi.object({
    title:       Joi.string().min(3).max(100),
    category:    Joi.string().valid(...validCategories),
    description: Joi.string().allow('').max(500),
    location:    Joi.string(),
    condition:   Joi.string().allow('').max(100),
    safeHub:     Joi.string().hex().length(24).optional().allow('', null).messages({
      'string.length': 'معرّف المركز غير صحيح',
    }),
  }).unknown(true);

  return schema.validateAsync(data, { abortEarly: false });
};


// ============================================
// 2. Transformations
// ============================================


const getReferenceId = (value) => value?._id ?? value ?? null;

const isSameId = (left, right) => (
  left != null && right != null && left.toString() === right.toString()
);

// لا نكشف قائمة الانتظار أو هوية الحاجز للعموم؛ نعيد فقط الحالة اللازمة للواجهة.
exports.toPublicItem = (item, requesterId = null) => ({
  _id:           item._id,
  title:         item.title,
  description:   item.description,
  category:      item.category,
  location:      item.location,
  condition:     item.condition,
  imageUrl:      item.imageUrl,
  status:        item.status,
  waitlistCount: Number.isInteger(item.waitlistCount)
    ? item.waitlistCount
    : (item.waitlist?.length ?? 0),
  isInWaitlist: requesterId
    ? (item.waitlist ?? []).some(
        (entry) => isSameId(getReferenceId(entry.user), requesterId)
      )
    : false,
  bookingPreviouslyCancelled: requesterId
    ? (item.cancelledBy ?? []).some((id) => isSameId(getReferenceId(id), requesterId))
    : false,
  bookedAt:            item.bookedAt ?? null,
  recipientConfirmed:  Boolean(item.recipientConfirmed),
  donorConfirmed:      Boolean(item.donorConfirmed),
  recipientConfirmedAt:item.recipientConfirmedAt ?? null,
  donorConfirmedAt:    item.donorConfirmedAt ?? null,
  deliveredAt:         item.deliveredAt ?? null,
  expiryHours:         item.expiryHours,
  isRated:             Boolean(item.isRated),
  linkedRequestId:     item.linkedRequestId ?? null,
  safeHub: item.safeHub
    ? {
        _id:          getReferenceId(item.safeHub),
        name:         item.safeHub.name,
        address:      item.safeHub.address,
        city:         item.safeHub.city,
        workingHours: item.safeHub.workingHours,
      }
    : null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  donor: item.donor
    ? {
        _id:               getReferenceId(item.donor),
        name:              item.donor.name,
        trustScore:        item.donor.trustScore,
        avatar:            item.donor.avatar,
        isVerifiedStudent: item.donor.isVerifiedStudent,
      }
    : null,
  bookedBy: null,
});


// للمتبرع — يرى بيانات الحاجز (email + phone)
exports.toDonorItem = (item, requesterId = null) => ({
  ...exports.toPublicItem(item, requesterId),
  reportCount: item.reportCount ?? 0,
  reportId: item.reportId ?? null,
  bookedBy: item.bookedBy
    ? {
        _id:   getReferenceId(item.bookedBy),
        name:  item.bookedBy.name,
        phone: item.bookedBy.phone,
        email: item.bookedBy.email,
      }
    : null,
});


// للمستلم — يرى بيانات المتبرع (phone)
exports.toReceiverItem = (item, requesterId = null) => ({
  ...exports.toPublicItem(item, requesterId),
  reportId: item.reportId ?? null,
  bookedBy: item.bookedBy
    ? {
        _id:   getReferenceId(item.bookedBy),
        name:  item.bookedBy.name,
        avatar:item.bookedBy.avatar,
      }
    : null,
  donor: item.donor
    ? {
        _id:               getReferenceId(item.donor),
        name:              item.donor.name,
        phone:             item.donor.phone,
        trustScore:        item.donor.trustScore,
        isVerifiedStudent: item.donor.isVerifiedStudent,
      }
    : null,
});
