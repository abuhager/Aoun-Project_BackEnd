// dtos/donationRequestDto.js
// ✅ DC-12 FIX: هذا الملف كان يحتوي على الـ Model بدل الـ DTO! 
//    الـ Model الحقيقي موجود في models/DonationRequest.js
//    هذا الملف يجب أن يحتوي على: validation + transformation فقط

const Joi = require('joi');
const SystemSettings = require('../models/SystemSettings');

// ══════════════════════════════════════════════════════════════
// 1. Validation
// ══════════════════════════════════════════════════════════════

// ✅ DC-12: التصنيفات ديناميكية من SystemSettings — لا hardcoded
exports.validateCreateRequest = async (data) => {
  const settings       = await SystemSettings.getCached();
  const validCategories = settings.categories;

  return Joi.object({
    title: Joi.string().trim().min(3).max(100).required().messages({
      'string.empty': 'عنوان الطلب مطلوب',
      'string.min':   'العنوان يجب أن يكون 3 أحرف على الأقل',
      'string.max':   'العنوان لا يتجاوز 100 حرف',
    }),
    // ✅ التصنيف من SystemSettings — يتغير ديناميكياً مع تغيير الإعدادات
    category: Joi.string()
      .valid(...validCategories)
      .required()
      .messages({
        'string.empty': 'التصنيف مطلوب',
        'any.only':     `التصنيف غير صالح. المتاح: ${validCategories.join(', ')}`,
      }),
    urgency: Joi.string()
      .valid('low', 'medium', 'high')
      .default('medium'),
    description: Joi.string().trim().max(500).optional().allow(''),
    location: Joi.string().trim().min(2).max(100).required().messages({
      'string.empty': 'الموقع مطلوب',
    }),
  }).validateAsync(data, { abortEarly: false, stripUnknown: true });
};

exports.validateUpdateRequest = async (data) => {
  const settings        = await SystemSettings.getCached();
  const validCategories = settings.categories;

  return Joi.object({
    title:       Joi.string().trim().min(3).max(100).optional(),
    category:    Joi.string().valid(...validCategories).optional(),
    urgency:     Joi.string().valid('low', 'medium', 'high').optional(),
    description: Joi.string().trim().max(500).optional().allow(''),
    location:    Joi.string().trim().min(2).max(100).optional(),
  }).validateAsync(data, { abortEarly: false, stripUnknown: true });
};

// ══════════════════════════════════════════════════════════════
// 2. Transformations — مطابقة للـ Frontend DonationRequest interface
// ══════════════════════════════════════════════════════════════

exports.toPublicRequest = (req) => ({
  _id:         req._id,
  title:       req.title,
  category:    req.category,
  urgency:     req.urgency,
  description: req.description ?? null,
  location:    req.location,
  status:      req.status,
  month:       req.month       ?? null,
  expiresAt:   req.expiresAt   ?? null,
  createdAt:   req.createdAt,
  updatedAt:   req.updatedAt,
  requester: req.requester ? {
    _id:        req.requester._id,
    name:       req.requester.name,
    avatar:     req.requester.avatar     ?? null,
    trustScore: req.requester.trustScore ?? null,
    trustLevel: req.requester.trustLevel ?? null,
  } : null,
  // ✅ مطابق لـ DonationRequest.fulfilledByItem في Frontend
  fulfilledByItem: req.fulfilledByItem ? {
    _id:                req.fulfilledByItem._id,
    status:             req.fulfilledByItem.status,
    condition:          req.fulfilledByItem.condition,
    recipientConfirmed: req.fulfilledByItem.recipientConfirmed ?? false,
    donorConfirmed:     req.fulfilledByItem.donorConfirmed     ?? false,
    safeHub: req.fulfilledByItem.safeHub ? {
      name:    req.fulfilledByItem.safeHub.name,
      city:    req.fulfilledByItem.safeHub.city,
      address: req.fulfilledByItem.safeHub.address,
    } : null,
    donor: req.fulfilledByItem.donor ? {
      _id:  req.fulfilledByItem.donor._id,
      name: req.fulfilledByItem.donor.name,
    } : null,
  } : null,
});