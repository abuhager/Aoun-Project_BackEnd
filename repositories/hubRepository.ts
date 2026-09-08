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
  SafeHub.find({
    $or: [
      { lifecycleState: 'active', isActive: { $ne: false } },
      { lifecycleState: { $exists: false }, isActive: { $ne: false } },
    ],
  })
    .sort({ city: 1, name: 1 })
    .select('-createdBy')
    .lean();

export const findById = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findById(id).session(session).lean();

const activeHubFilter = (id: EntityId): {
  _id: EntityId;
  isActive: { $ne: boolean };
  $or: Array<
    { lifecycleState: 'active' }
    | { lifecycleState: { $exists: boolean } }
  >;
} => ({
  _id: id,
  isActive: { $ne: false },
  $or: [
    { lifecycleState: 'active' },
    { lifecycleState: { $exists: false } },
  ],
});

export const findActiveById = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findOne(activeHubFilter(id)).session(session).lean();

/**
 * يكتب على سجل المركز داخل نفس transaction الخاصة بإنشاء المرجع. بهذه
 * الكتابة يتصادم أي إنشاء/تعديل متزامن مع عملية التعطيل بدلاً من المرور بين
 * check وdeactivate.
 */
export const acquireActiveForWrite = (
  id: EntityId,
  session: RepositorySession
) => SafeHub.findOneAndUpdate(
  activeHubFilter(id),
  {
    $inc: { operationVersion: 1 },
    $set: { lifecycleState: 'active', isActive: true },
  },
  { returnDocument: 'after', session: session ?? undefined }
).select('_id name city address lifecycleState operationVersion').lean();

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

export const beginDeactivation = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findOneAndUpdate(
  activeHubFilter(id),
  {
    $set: { isActive: false, lifecycleState: 'deactivating' },
    $inc: { operationVersion: 1 },
  },
  { returnDocument: 'after', session: session ?? undefined }
);

export const restoreActive = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findOneAndUpdate(
  { _id: id, lifecycleState: 'deactivating' },
  { $set: { isActive: true, lifecycleState: 'active' } },
  { returnDocument: 'after', session: session ?? undefined }
);

export const completeDeactivation = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findOneAndUpdate(
  { _id: id, lifecycleState: 'deactivating' },
  { $set: { isActive: false, lifecycleState: 'inactive' } },
  { returnDocument: 'after', session: session ?? undefined }
);

export const reactivateById = (
  id: EntityId,
  session: RepositorySession = null
) => SafeHub.findOneAndUpdate(
  { _id: id, isActive: false, lifecycleState: { $ne: 'deactivating' } },
  { $set: { isActive: true, lifecycleState: 'active' }, $inc: { operationVersion: 1 } },
  { returnDocument: 'after', session: session ?? undefined }
);

export default {
  findAll,
  findAllActive,
  findById,
  findActiveById,
  create,
  updateById,
  acquireActiveForWrite,
  beginDeactivation,
  restoreActive,
  completeDeactivation,
  reactivateById,
};
