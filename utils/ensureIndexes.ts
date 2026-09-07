import 'dotenv/config';
import mongoose from 'mongoose';
import type { mongo } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import AdminLog from '../models/AdminLog.js';
import Conversation from '../models/Conversation.js';
import DonationOffer from '../models/DonationOffer.js';
import DonationRequest from '../models/DonationRequest.js';
import Item from '../models/Item.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import OutboxEvent from '../models/OutboxEvent.js';
import Rating from '../models/Rating.js';
import Report from '../models/Report.js';
import SafeHub from '../models/SafeHub.js';
import SystemSettings from '../models/SystemSettings.js';
import User from '../models/User.js';

type IndexDefinition = {
  key: Record<string, mongo.IndexDirection>;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
  collation?: mongo.CollationOptions;
  replaceIfDifferent?: boolean;
};

type ExistingIndex = IndexDefinition & { name: string };
type SchemaIndex = [
  fields: Record<string, mongo.IndexDirection>,
  options: mongoose.IndexOptions,
];
type IndexableModel = {
  modelName: string;
  collection: mongoose.Collection;
  schema: { indexes(): SchemaIndex[] };
};
type IndexGroup = { model: IndexableModel; indexes: IndexDefinition[] };
type IndexableCollection = mongoose.Collection;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isNamespaceMissing = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: number; codeName?: string };
  return record.code === 26 || record.codeName === 'NamespaceNotFound';
};

const indexNameForKey = (key: Record<string, mongo.IndexDirection>): string => (
  Object.entries(key)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join('_')
);

const shouldReplaceDifferentIndex = (index: IndexDefinition): boolean => Boolean(
  index.unique
  || index.partialFilterExpression
  || index.expireAfterSeconds !== undefined
);

const toIndexDefinition = ([key, options]: SchemaIndex): IndexDefinition => {
  const ttl = options.expireAfterSeconds;
  const definition: IndexDefinition = {
    key,
    name: options.name ?? indexNameForKey(key),
    unique: options.unique === undefined
      ? undefined
      : (Array.isArray(options.unique) ? options.unique[0] : Boolean(options.unique)),
    sparse: options.sparse === undefined ? undefined : Boolean(options.sparse),
    expireAfterSeconds: ttl === undefined ? undefined : Number(ttl),
    partialFilterExpression: options.partialFilterExpression as Record<string, unknown> | undefined,
    collation: options.collation,
  };

  definition.replaceIfDifferent = shouldReplaceDifferentIndex(definition);
  return definition;
};

// الـModels هي المصدر الوحيد لتعريف الفهارس. إضافة Model أو index جديد إلى schema
// تجعله جزءاً من مهمة production تلقائياً وتمنع انجراف manifest يدوي منفصل.
const indexModels = [
  AdminLog,
  Conversation,
  DonationOffer,
  DonationRequest,
  Item,
  Message,
  Notification,
  OutboxEvent,
  Rating,
  Report,
  SafeHub,
  SystemSettings,
  User,
] as unknown as IndexableModel[];

const getIndexGroups = (): IndexGroup[] => indexModels.map((model) => ({
  model,
  indexes: model.schema.indexes().map(toIndexDefinition),
}));

const indexKeysEqual = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): boolean =>
  isDeepStrictEqual(Object.entries(left ?? {}), Object.entries(right ?? {}));

const indexDefinitionsEquivalent = (
  existing: IndexDefinition,
  requested: IndexDefinition
): boolean => {
  const existingTtl = existing.expireAfterSeconds === undefined
    ? undefined
    : Number(existing.expireAfterSeconds);
  const requestedTtl = requested.expireAfterSeconds === undefined
    ? undefined
    : Number(requested.expireAfterSeconds);

  return indexKeysEqual(existing.key, requested.key)
    && Boolean(existing.unique) === Boolean(requested.unique)
    && Boolean(existing.sparse) === Boolean(requested.sparse)
    && existingTtl === requestedTtl
    && isDeepStrictEqual(existing.partialFilterExpression, requested.partialFilterExpression)
    && isDeepStrictEqual(existing.collation, requested.collation);
};

const indexCreateOptions = ({
  key: _key,
  replaceIfDifferent: _replace,
  ...options
}: IndexDefinition): mongo.CreateIndexesOptions => Object.fromEntries(
  Object.entries(options).filter(([, value]) => value !== undefined && value !== null)
) as mongo.CreateIndexesOptions;

const listExistingIndexes = async (
  collection: IndexableCollection
): Promise<ExistingIndex[]> => {
  try {
    return await collection.indexes() as unknown as ExistingIndex[];
  } catch (error: unknown) {
    if (isNamespaceMissing(error)) return [];
    throw error;
  }
};

const findObsoleteDonationRequestTtlIndexes = async (): Promise<ExistingIndex[]> => {
  const existingIndexes = await listExistingIndexes(DonationRequest.collection);
  return existingIndexes.filter((index: ExistingIndex) =>
    index.expireAfterSeconds !== undefined
    && indexKeysEqual(index.key, { expiresAt: 1 })
  );
};

const dropObsoleteDonationRequestTtlIndexes = async (): Promise<void> => {
  for (const index of await findObsoleteDonationRequestTtlIndexes()) {
    await DonationRequest.collection.dropIndex(index.name);
  }
};

const buildUniqueSafetyMatch = (index: IndexDefinition): Record<string, unknown> => {
  const filters: Record<string, unknown>[] = [];
  if (index.partialFilterExpression) filters.push(index.partialFilterExpression);
  if (index.sparse) {
    filters.push({
      $or: Object.keys(index.key).map((field) => ({ [field]: { $exists: true } })),
    });
  }
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  return { $and: filters };
};

const assertUniqueIndexCanBeCreated = async (
  collection: IndexableCollection,
  index: IndexDefinition
): Promise<void> => {
  if (!index.unique) return;

  const groupId = Object.fromEntries(
    Object.keys(index.key).map((field, position) => [`key${position}`, `$${field}`])
  );
  const duplicates = await collection.aggregate([
    { $match: buildUniqueSafetyMatch(index) },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
    { $project: { _id: 0 } },
  ], { allowDiskUse: true }).toArray();

  if (duplicates.length > 0) {
    throw new Error(
      `توجد بيانات مكررة تمنع إنشاء الفهرس الفريد ${index.name}; نظّف التكرار قبل إعادة المحاولة`
    );
  }
};

const replaceIndexSafely = async (
  collection: IndexableCollection,
  existing: ExistingIndex,
  requested: IndexDefinition
): Promise<void> => {
  await assertUniqueIndexCanBeCreated(collection, requested);
  await collection.dropIndex(existing.name);

  try {
    await collection.createIndex(requested.key, indexCreateOptions(requested));
  } catch (error: unknown) {
    try {
      await collection.createIndex(existing.key, indexCreateOptions(existing));
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error, rollbackError],
        `فشل إنشاء ${requested.name} وفشل استرجاع ${existing.name}`
      );
    }
    throw error;
  }
};

const verifyIndexes = async (): Promise<void> => {
  const failures: Error[] = [];

  try {
    const obsolete = await findObsoleteDonationRequestTtlIndexes();
    if (obsolete.length > 0) {
      failures.push(new Error(
        `DonationRequest: توجد فهارس TTL قديمة على expiresAt: ${obsolete.map(({ name }) => name).join(', ')}`
      ));
    }
  } catch (error: unknown) {
    failures.push(new Error(
      `DonationRequest: تعذر فحص فهارس TTL القديمة: ${getErrorMessage(error)}`,
      { cause: error }
    ));
  }

  for (const { model, indexes } of getIndexGroups()) {
    let existingIndexes: ExistingIndex[];
    try {
      existingIndexes = await listExistingIndexes(model.collection);
    } catch (error: unknown) {
      failures.push(new Error(
        `${model.modelName}: تعذر قراءة الفهارس: ${getErrorMessage(error)}`,
        { cause: error }
      ));
      continue;
    }

    for (const requested of indexes) {
      const existing = existingIndexes.find((candidate) =>
        indexKeysEqual(candidate.key, requested.key)
      );
      if (!existing) {
        failures.push(new Error(`${model.modelName}.${requested.name}: الفهرس مفقود`));
      } else if (!indexDefinitionsEquivalent(existing, requested)) {
        failures.push(new Error(
          `${model.modelName}.${requested.name}: خصائص الفهرس لا تطابق schema (${existing.name})`
        ));
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `فشل التحقق من ${failures.length} فهرس/فهارس`);
  }
};

const ensureIndexes = async (): Promise<void> => {
  const failures: Error[] = [];

  try {
    // الطلب المنتهي يجب أن يُؤرشف، لا أن يُحذف تلقائياً من MongoDB.
    await dropObsoleteDonationRequestTtlIndexes();
  } catch (error: unknown) {
    failures.push(new Error(
      `DonationRequest: تعذر إزالة فهرس TTL القديم: ${getErrorMessage(error)}`,
      { cause: error }
    ));
  }

  for (const { model, indexes } of getIndexGroups()) {
    let existingIndexes: ExistingIndex[];
    try {
      existingIndexes = await listExistingIndexes(model.collection);
    } catch (error: unknown) {
      failures.push(new Error(
        `${model.modelName}: تعذر قراءة الفهارس: ${getErrorMessage(error)}`,
        { cause: error }
      ));
      continue;
    }

    for (const index of indexes) {
      const sameKeyIndex = existingIndexes.find((existing) =>
        indexKeysEqual(existing.key, index.key)
      );

      if (sameKeyIndex) {
        if (
          !indexDefinitionsEquivalent(sameKeyIndex, index)
          && index.replaceIfDifferent
        ) {
          try {
            await replaceIndexSafely(model.collection, sameKeyIndex, index);
            const indexPosition = existingIndexes.indexOf(sameKeyIndex);
            existingIndexes.splice(indexPosition, 1, index);
          } catch (error: unknown) {
            failures.push(new Error(
              `${model.modelName}.${index.name}: تعذر ترقية الفهرس القديم: ${getErrorMessage(error)}`,
              { cause: error }
            ));
          }
        } else if (!indexDefinitionsEquivalent(sameKeyIndex, index)) {
          failures.push(new Error(
            `${model.modelName}.${index.name}: يوجد فهرس بنفس الحقول لكن بخصائص مختلفة (${sameKeyIndex.name})`
          ));
        }
        continue;
      }

      try {
        await assertUniqueIndexCanBeCreated(model.collection, index);
        await model.collection.createIndex(index.key, indexCreateOptions(index));
        existingIndexes.push(index);
      } catch (error: unknown) {
        failures.push(new Error(
          `${model.modelName}.${index.name}: ${getErrorMessage(error)}`,
          { cause: error }
        ));
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `فشل إنشاء ${failures.length} فهرس/فهارس`);
  }
};

const isDirectExecution = /(?:^|[\\/])ensureIndexes\.(?:ts|js)$/.test(process.argv[1] ?? '');
if (isDirectExecution) {
  if (!process.env.MONGO_URI) {
    console.error('[Indexes] MONGO_URI مطلوب لتشغيل مهمة الفهارس');
    process.exitCode = 1;
  } else {
    const operation = process.argv.includes('--verify') ? verifyIndexes : ensureIndexes;
    mongoose.connect(process.env.MONGO_URI, { autoIndex: false })
      .then(operation)
      .then(() => console.log(
        process.argv.includes('--verify')
          ? '[Indexes] الفهارس مطابقة للـschemas'
          : '[Indexes] اكتملت المزامنة بنجاح'
      ))
      .catch((error: unknown) => {
        console.error('[Indexes] فشلت المهمة:', error);
        process.exitCode = 1;
      })
      .finally(() => mongoose.disconnect());
  }
}

export default ensureIndexes;

export {
  assertUniqueIndexCanBeCreated,
  dropObsoleteDonationRequestTtlIndexes,
  getIndexGroups,
  indexCreateOptions,
  indexDefinitionsEquivalent,
  indexNameForKey,
  verifyIndexes,
};
