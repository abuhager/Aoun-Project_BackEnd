// repositories/hubRepository.js — PATCHED ✅
// التغيير الوحيد: إضافة findAll() للأدمن

const SafeHub = require('../models/SafeHub');

const ALLOWED_UPDATE_FIELDS = [
  'name', 'address', 'city', 'coordinates', 'isActive', 'workingHours',
];

// ✅ جديد — للأدمن: كل المراكز بكل الحالات
exports.findAll = () =>
  SafeHub.find({}).sort({ isActive: -1, createdAt: -1 }).lean();

exports.findAllActive = () =>
  SafeHub.find({ isActive: true }).sort({ city: 1 }).select('-createdBy').lean();

exports.findById = (id) =>
  SafeHub.findById(id).lean();

exports.create = (data) =>
  SafeHub.create(data);

exports.updateById = (id, rawBody) => {
  const safeUpdate = {};
  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (rawBody[field] !== undefined) safeUpdate[field] = rawBody[field];
  }
  return SafeHub.findByIdAndUpdate(id, { $set: safeUpdate }, {
    returnDocument: 'after', runValidators: true,
  });
};

exports.deactivateById = (id) =>
  SafeHub.findByIdAndUpdate(id, { $set: { isActive: false } }, { returnDocument: 'after' });
