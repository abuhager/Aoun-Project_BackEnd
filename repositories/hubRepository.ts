import SafeHub from '../models/SafeHub.js';
import { ALLOWED_UPDATE_FIELDS } from '../dtos/hubDto.js';
import type { EntityId, RepositoryPayload } from './repositoryTypes.js';

export const findAll = () =>
  SafeHub.find({}).sort({ isActive: -1, createdAt: -1 }).lean();

export const findAllActive = () =>
  // يدعم السجلات القديمة التي لا تحتوي isActive؛ التعطيل الصريح وحده يخفي المركز.
  SafeHub.find({ isActive: { $ne: false } })
    .sort({ city: 1, name: 1 })
    .select('-createdBy')
    .lean();

export const findById = (id: EntityId) =>
  SafeHub.findById(id).lean();

export const create = (data: RepositoryPayload) =>
  SafeHub.create(data);

export const updateById = (id: EntityId, rawBody: RepositoryPayload) => {
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

export const deactivateById = (id: EntityId) =>
  SafeHub.findByIdAndUpdate(id, { $set: { isActive: false } }, { returnDocument: 'after' });

export const reactivateById = (id: EntityId) =>
  SafeHub.findByIdAndUpdate(id, { $set: { isActive: true } }, { returnDocument: 'after' });

export default { findAll, findAllActive, findById, create, updateById, deactivateById, reactivateById };
