// repositories/hubRepository.js
const SafeHub = require('../models/SafeHub');

const ALLOWED_UPDATE_FIELDS = [
  'name', 'address', 'city', 'coordinates', 'isActive', 'workingHours',
];

exports.findAllActive = () =>
  SafeHub.find({ isActive: true }).select('-createdBy').lean();

exports.findById = (id) =>
  SafeHub.findById(id).lean();

exports.create = ({ name, address, city, coordinates, workingHours, createdBy }) =>
  SafeHub.create({ name, address, city, coordinates, workingHours, createdBy });

exports.updateById = (id, rawBody) => {
  // ✅ فلترة الحقول المسموحة — منع Mass Assignment
  const safeUpdate = {};
  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (rawBody[field] !== undefined) safeUpdate[field] = rawBody[field];
  }
  return SafeHub.findByIdAndUpdate(id, safeUpdate, {
    new: true,
    runValidators: true,
  });
};

exports.deactivateById = (id) =>
  SafeHub.findByIdAndUpdate(id, { isActive: false }, { new: true });