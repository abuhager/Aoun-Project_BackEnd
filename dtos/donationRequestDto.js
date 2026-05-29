// dtos/donationRequestDto.js
const Joi = require('joi');

exports.validateDonationRequest = (data) =>
  Joi.object({
    title:       Joi.string().min(3).max(100).required()
                   .messages({ 'string.empty': 'عنوان الطلب مطلوب' }),
    description: Joi.string().allow('').max(500),
    category:    Joi.string().min(1).required()
                   .messages({ 'string.empty': 'التصنيف مطلوب' }),
    location:    Joi.string().min(2).max(100).required()
                   .messages({ 'string.empty': 'الموقع مطلوب' }),
    urgency:     Joi.string().valid('low', 'medium', 'high').default('medium'),
  }).options({ stripUnknown: true }).validate(data);
