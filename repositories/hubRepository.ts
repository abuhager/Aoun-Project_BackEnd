import SafeHub from '../models/SafeHub.js';
import { ALLOWED_UPDATE_FIELDS } from '../dtos/hubDto.js';
import type {
  EntityId,
  RepositoryPayload,
  RepositorySession,
} from './repositoryTypes.js';

export const findAll = () =>
  SafeHub.find({}).sort({ isActive: -1, createdAt: -1 }).lean();

export const findAllActive = () =>
  // يدعم السجلات القديمة التي لا تحتوي isActive؛ التعطيل الصريح وحده يخفي المركز.
  SafeHub.find({ isActive: { $ne: false } })
    .sort({ city: 1, name: 1 })
    .select('-createdBy')
    .lean();

export const findById = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findById(id).session(session).lean();

export const create = async (
  data: RepositoryPayload,
  session: RepositorySession = null
) => {
  if (!session) return SafeHub.create(data);
  const [hub] = await SafeHub.create([data], { session });
  return hub;
};

export const updateById = (
  id: EntityId,
  rawBody: RepositoryPayload,
  session: RepositorySession = null
) => {
  const safeUpdate: RepositoryPayload = {};
  for (const field of ALLOWED_UPDATE_FIELDS) {          // ✅ من dto مباشرةً
    if (rawBody[field] !== undefined) safeUpdate[field] = rawBody[field];
  }

  // Guard: لا تُنفّذ query إذا لم يكن هناك شيء للتحديث
  if (Object.keys(safeUpdate).length === 0) return Promise.resolve(null);

  return SafeHub.findByIdAndUpdate(id, { $set: safeUpdate }, {
    returnDocument: 'after',
    runValidators:  true,
    session: session ?? undefined,
  });
};

export const deactivateById = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findByIdAndUpdate(
  id,
  { $set: { isActive: false } },
  { returnDocument: 'after', session: session ?? undefined }
);

export const reactivateById = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findByIdAndUpdate(
  id,
  { $set: { isActive: true } },
  { returnDocument: 'after', session: session ?? undefined }
);

export default { findAll, findAllActive, findById, create, updateById, deactivateById, reactivateById };
