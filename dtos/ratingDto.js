// dtos/ratingDto.js
const Joi = require('joi');

exports.validateRating = (body) =>
  Joi.object({
    itemId: Joi.string().hex().length(24).required(),
    score:   Joi.number().integer().min(1).max(10).required(),
    comment: Joi.string().max(300).optional(),
  }).validate(body);