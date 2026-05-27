// dtos/reportDto.js
const Joi = require('joi');

const REASONS = ['لم يُسلّم الغرض','معلومات مضللة','سلوك غير لائق','غرض مختلف عن الوصف','أخرى'];

exports.validateReport = (body) =>
  Joi.object({
    reportedUserId: Joi.string().length(24).required(),
    itemId:         Joi.string().length(24).optional(),
    reason:         Joi.string().valid(...REASONS).required(),
    details:        Joi.string().max(500).optional(),
  }).validate(body);

exports.validateAppeal = (body) =>
  Joi.object({
    appealText: Joi.string().min(10).max(500).required(),
  }).validate(body);