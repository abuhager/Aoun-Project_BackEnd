// dtos/donationOfferDto.js
// ✅ DC-13 FIX: هذا الملف كان فارغاً تماماً (0 bytes)!
//    لا يوجد أي validation لعروض التبرع → أي بيانات تمر بدون فلترة

const Joi = require('joi');

// ══════════════════════════════════════════════════════════════
// 1. Validation
// ══════════════════════════════════════════════════════════════

exports.validateCreateOffer = (data) =>
  Joi.object({
    // ✅ مطابق لـ DonationOffer Model — condition enum محدد
    condition: Joi.string()
      .valid('جديد', 'مستعمل ممتاز', 'مستعمل جيد')
      .required()
      .messages({
        'string.empty': 'حالة الغرض مطلوبة',
        'any.only':     'حالة الغرض يجب أن تكون: جديد، مستعمل ممتاز، أو مستعمل جيد',
      }),
    safeHub: Joi.string().hex().length(24).required().messages({
      'string.empty':  'مركز التسليم مطلوب',
      'string.length': 'معرّف المركز غير صحيح',
    }),
    description: Joi.string().trim().max(500).optional().allow(''),
    // imageUrl يُضاف بعد رفع الصورة في الـ Controller — لا يُرسَل من الـ Client
  }).validate(data, { abortEarly: false, stripUnknown: true });

exports.validateUpdateOffer = (data) =>
  Joi.object({
    condition:   Joi.string().valid('جديد', 'مستعمل ممتاز', 'مستعمل جيد').optional(),
    safeHub:     Joi.string().hex().length(24).optional(),
    description: Joi.string().trim().max(500).optional().allow(''),
  }).validate(data, { abortEarly: false, stripUnknown: true });

// ══════════════════════════════════════════════════════════════
// 2. Transformations — مطابق لـ DonationOffer interface في Frontend
// ══════════════════════════════════════════════════════════════

exports.toPublicOffer = (offer) => ({
  _id:         offer._id,
  request:     offer.request,
  condition:   offer.condition,
  description: offer.description ?? null,
  imageUrl:    offer.imageUrl     ?? null,
  // ✅ مطابق لـ DonationOffer.status في Frontend — يشمل 'cancelled_by_requester'
  status:      offer.status,
  createdAt:   offer.createdAt,
  donor: offer.donor ? {
    _id:        offer.donor._id,
    name:       offer.donor.name,
    avatar:     offer.donor.avatar     ?? null,
    trustLevel: offer.donor.trustLevel ?? null,
    trustScore: offer.donor.trustScore ?? null,
  } : null,
  safeHub: offer.safeHub ? {
    _id:     offer.safeHub._id,
    name:    offer.safeHub.name,
    city:    offer.safeHub.city,
    address: offer.safeHub.address,
  } : null,
});