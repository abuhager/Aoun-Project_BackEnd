import 'dotenv/config';
import mongoose from 'mongoose';
import type { CollationOptions, CreateIndexesOptions, IndexDirection } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import Item from '../models/Item.js';
import Report from '../models/Report.js';
import DonationRequest from '../models/DonationRequest.js';
import DonationOffer from '../models/DonationOffer.js';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

type IndexDefinition = {
  key: Record<string, IndexDirection>;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
  collation?: CollationOptions;
  replaceIfDifferent?: boolean;
};

type ExistingIndex = IndexDefinition & { name: string };
type IndexableModel = {
  modelName: string;
  collection: mongoose.Collection;
};
type IndexableCollection = mongoose.Collection;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isNamespaceMissing = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: number; codeName?: string };
  return record.code === 26 || record.codeName === 'NamespaceNotFound';
};

const indexGroups: Array<{ model: IndexableModel; indexes: IndexDefinition[] }> = [
  {
    model: Item,
    indexes: [
      { key: { status: 1, createdAt: -1 }, name: 'status_createdAt' },
      { key: { donor: 1, status: 1 }, name: 'donor_status' },
      { key: { bookedBy: 1, status: 1 }, name: 'bookedBy_status' },
      { key: { category: 1, status: 1 }, name: 'category_status' },
      { key: { 'waitlist.user': 1 }, name: 'waitlist_user' },
      { key: { safeHub: 1 }, name: 'safeHub' },
      {
        key: { linkedRequestId: 1 },
        unique: true,
        partialFilterExpression: { linkedRequestId: { $type: 'objectId' } },
        name: 'linked_request_unique',
        replaceIfDifferent: true,
      },
    ],
  },
  {
    model: Report,
    indexes: [
      { key: { reportedUser: 1, status: 1 }, name: 'reportedUser_status' },
      { key: { status: 1, createdAt: -1 }, name: 'status_createdAt' },
      { key: { reporter: 1 }, name: 'reporter' },
      {
        key: { reporter: 1, reportedUser: 1, relatedItem: 1, status: 1 },
        unique: true,
        partialFilterExpression: { status: 'pending' },
        name: 'pending_report_context_unique',
        replaceIfDifferent: true,
      },
    ],
  },
  {
    model: DonationRequest,
    indexes: [
      { key: { status: 1, expiresAt: 1 }, name: 'status_expiresAt' },
      { key: { requester: 1, status: 1, month: 1 }, name: 'requester_status_month' },
      { key: { category: 1, status: 1 }, name: 'category_status' },
    ],
  },
  {
    model: DonationOffer,
    indexes: [
      {
        key: { request: 1, donor: 1 },
        unique: true,
        name: 'request_donor_unique',
      },
      { key: { safeHub: 1, status: 1 }, name: 'safeHub_status' },
      { key: { donor: 1, status: 1 }, name: 'donor_status' },
    ],
  },
  {
    model: User,
    indexes: [
      {
        key: { phone: 1 },
        unique: true,
        partialFilterExpression: { phoneVerified: true },
        name: 'phone_verified_unique',
      },
      { key: { trustLevel: 1 }, name: 'trustLevel' },
      { key: { isBanned: 1 }, name: 'isBanned' },
    ],
  },
  {
    model: Conversation,
    indexes: [
      { key: { item: 1 }, name: 'item_1' },
      { key: { owner: 1 }, name: 'owner_1' },
      { key: { requester: 1 }, name: 'requester_1' },
      {
        key: { item: 1, owner: 1, requester: 1 },
        unique: true,
        name: 'item_1_owner_1_requester_1',
      },
      { key: { participants: 1, updatedAt: -1 }, name: 'participants_1_updatedAt_-1' },
    ],
  },
  {
    model: Message,
    indexes: [
      { key: { conversation: 1 }, name: 'conversation_1' },
      { key: { sender: 1 }, name: 'sender_1' },
      { key: { read: 1 }, name: 'read_1' },
      { key: { conversation: 1, createdAt: 1 }, name: 'conversation_1_createdAt_1' },
      {
        key: { conversation: 1, sender: 1, read: 1 },
        name: 'conversation_1_sender_1_read_1',
      },
      {
        key: { conversation: 1, read: 1, sender: 1 },
        name: 'conversation_1_read_1_sender_1',
      },
      {
        key: { conversation: 1, sender: 1, clientMessageId: 1 },
        unique: true,
        partialFilterExpression: { clientMessageId: { $type: 'string' } },
        name: 'conversation_sender_clientMessage_unique',
        replaceIfDifferent: true,
      },
    ],
  },
];

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
}: IndexDefinition): CreateIndexesOptions => options;

const dropObsoleteDonationRequestTtlIndexes = async (): Promise<void> => {
  const collection = DonationRequest.collection;
  const existingIndexes = await listExistingIndexes(collection);
  const obsoleteIndexes = existingIndexes.filter((index: ExistingIndex) =>
    index.expireAfterSeconds !== undefined
    && indexKeysEqual(index.key, { expiresAt: 1 })
  );

  for (const index of obsoleteIndexes) {
    await collection.dropIndex(index.name);
  }
};

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

  for (const { model, indexes } of indexGroups) {
    let existingIndexes;
    try {
      existingIndexes = await listExistingIndexes(model.collection);
    } catch (error: unknown) {
      failures.push(new Error(`${model.modelName}: تعذر قراءة الفهارس: ${getErrorMessage(error)}`, { cause: error }));
      continue;
    }

    for (const index of indexes) {
      const sameKeyIndex = existingIndexes.find((existing: ExistingIndex) =>
        indexKeysEqual(existing.key, index.key)
      );

      if (sameKeyIndex) {
        if (!indexDefinitionsEquivalent(sameKeyIndex, index)) {
          if (index.replaceIfDifferent) {
            try {
              await model.collection.dropIndex(sameKeyIndex.name);
              await model.collection.createIndex(index.key, indexCreateOptions(index));
              const indexPosition = existingIndexes.indexOf(sameKeyIndex);
              existingIndexes.splice(indexPosition, 1, index);
            } catch (error: unknown) {
              failures.push(new Error(
                `${model.modelName}.${index.name}: تعذر ترقية الفهرس القديم: ${getErrorMessage(error)}`,
                { cause: error }
              ));
            }
            continue;
          }

          const isLegacyPhoneIndex = model.modelName === 'User'
            && index.name === 'phone_verified_unique'
            && sameKeyIndex.name === 'phone_1'
            && Boolean(sameKeyIndex.unique)
            && !sameKeyIndex.partialFilterExpression;

          if (isLegacyPhoneIndex) {
            try {
              await model.collection.dropIndex(sameKeyIndex.name);
              await model.collection.createIndex(index.key, indexCreateOptions(index));
              const indexPosition = existingIndexes.indexOf(sameKeyIndex);
              existingIndexes.splice(indexPosition, 1, index);
            } catch (error: unknown) {
              failures.push(new Error(
                `${model.modelName}.${index.name}: تعذر ترقية فهرس الهاتف القديم: ${getErrorMessage(error)}`,
                { cause: error }
              ));
            }
            continue;
          }

          failures.push(new Error(
            `${model.modelName}.${index.name}: يوجد فهرس بنفس الحقول لكن بخصائص مختلفة (${sameKeyIndex.name})`
          ));
        }
        continue;
      }

      try {
        await model.collection.createIndex(index.key, indexCreateOptions(index));
        existingIndexes.push(index);
      } catch (error: unknown) {
        failures.push(new Error(`${model.modelName}.${index.name}: ${getErrorMessage(error)}`, { cause: error }));
      }
    }
  }

  if (failures.length) {
    throw new AggregateError(failures, `فشل إنشاء ${failures.length} فهرس/فهارس`);
  }
};

export default ensureIndexes;

export { indexDefinitionsEquivalent };

export { dropObsoleteDonationRequestTtlIndexes };

const isDirectExecution = /(?:^|[\\/])ensureIndexes\.(?:ts|js)$/.test(process.argv[1] ?? '');
if (isDirectExecution) {
  if (!process.env.MONGO_URI) {
    console.error('[Indexes] MONGO_URI مطلوب لتشغيل مهمة الفهارس');
    process.exitCode = 1;
  } else {
    mongoose.connect(process.env.MONGO_URI, { autoIndex: false })
      .then(ensureIndexes)
      .then(() => console.log('[Indexes] اكتملت المهمة بنجاح'))
      .catch((error: unknown) => {
        console.error('[Indexes] فشلت المهمة:', error);
        process.exitCode = 1;
      })
      .finally(() => mongoose.disconnect());
  }
}
