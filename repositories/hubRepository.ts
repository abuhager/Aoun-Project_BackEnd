// repositories/hubRepository.js — ✅ PATCHED [ARCH-01]
// التغيير الوحيد: استيراد ALLOWED_UPDATE_FIELDS من hubDto بدل تكرارها

const SafeHub = require('../models/SafeHub');
// ✅ ARCH-01: مصدر واحد للحقيقة — حذف الـ const المكررة واستيراد من dto
const { ALLOWED_UPDATE_FIELDS } = require('../dtos/hubDto');
import type { EntityId, RepositoryPayload } from './repositoryTypes';

// Admin — كل المراكز بكل الحالات
exports.findAll = () =>
  SafeHub.find({}).sort({ isActive: -1, createdAt: -1 }).lean();

// Public — النشطة فقط
exports.findAllActive = () =>
  // يدعم السجلات القديمة التي لا تحتوي isActive؛ التعطيل الصريح وحده يخفي المركز.
  SafeHub.find({ isActive: { $ne: false } })
    .sort({ city: 1, name: 1 })
    .select('-createdBy')
    .lean();

exports.findById = (id: EntityId) =>
  SafeHub.findById(id).lean();

exports.create = (data: RepositoryPayload) =>
  SafeHub.create(data);

exports.updateById = (id: EntityId, rawBody: RepositoryPayload) => {
  const safeUpdate: RepositoryPayload = {};
  for (const field of ALLOWED_UPDATE_FIELDS) {          // ✅ من dto مباشرةً
    if (rawBody[field] !== undefined) safeUpdate[field] = rawBody[field];
  }

  // Guard: لا تُنفّذ query إذا لم يكن هناك شيء للتحديث
  if (Object.keys(safeUpdate).length === 0) return Promise.resolve(null);

  return SafeHub.findByIdAndUpdate(id, { $set: safeUpdate }, {
    returnDocument: 'after',
    runValidators:  true,
  });
};

exports.deactivateById = (id: EntityId) =>
  SafeHub.findByIdAndUpdate(id, { $set: { isActive: false } }, { returnDocument: 'after' });

exports.reactivateById = (id: EntityId) =>
  SafeHub.findByIdAndUpdate(id, { $set: { isActive: true } }, { returnDocument: 'after' });
