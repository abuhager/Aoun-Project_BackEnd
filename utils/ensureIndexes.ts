if (require.main === module) require('dotenv').config();

const mongoose = require('mongoose');
const { isDeepStrictEqual } = require('node:util');
const Item = require('../models/Item');
const Report = require('../models/Report');
const DonationRequest = require('../models/DonationRequest');
const DonationOffer = require('../models/DonationOffer');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

type IndexDefinition = {
  key: Record<string, unknown>;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
  collation?: Record<string, unknown>;
  replaceIfDifferent?: boolean;
};

const indexGroups: Array<{ model: any; indexes: IndexDefinition[] }> = [
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

const indexKeysEqual = (left, right) =>
  isDeepStrictEqual(Object.entries(left ?? {}), Object.entries(right ?? {}));

const indexDefinitionsEquivalent = (existing, requested) => {
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
}: IndexDefinition) => options;

const dropObsoleteDonationRequestTtlIndexes = async () => {
  const existingIndexes = await listExistingIndexes(DonationRequest.collection);
  const obsoleteIndexes = existingIndexes.filter((index) =>
    index.expireAfterSeconds !== undefined
    && indexKeysEqual(index.key, { expiresAt: 1 })
  );

  for (const index of obsoleteIndexes) {
    await DonationRequest.collection.dropIndex(index.name);
  }
};

const listExistingIndexes = async (collection) => {
  try {
    return await collection.indexes();
  } catch (error) {
    if (error.code === 26 || error.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
};

const ensureIndexes = async () => {
  const failures = [];

  try {
    // الطلب المنتهي يجب أن يُؤرشف، لا أن يُحذف تلقائياً من MongoDB.
    await dropObsoleteDonationRequestTtlIndexes();
  } catch (error) {
    failures.push(new Error(
      `DonationRequest: تعذر إزالة فهرس TTL القديم: ${error.message}`,
      { cause: error }
    ));
  }

  for (const { model, indexes } of indexGroups) {
    let existingIndexes;
    try {
      existingIndexes = await listExistingIndexes(model.collection);
    } catch (error) {
      failures.push(new Error(`${model.modelName}: تعذر قراءة الفهارس: ${error.message}`, { cause: error }));
      continue;
    }

    for (const index of indexes) {
      const sameKeyIndex = existingIndexes.find((existing) =>
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
            } catch (error) {
              failures.push(new Error(
                `${model.modelName}.${index.name}: تعذر ترقية الفهرس القديم: ${error.message}`,
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
            } catch (error) {
              failures.push(new Error(
                `${model.modelName}.${index.name}: تعذر ترقية فهرس الهاتف القديم: ${error.message}`,
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
      } catch (error) {
        failures.push(new Error(`${model.modelName}.${index.name}: ${error.message}`, { cause: error }));
      }
    }
  }

  if (failures.length) {
    throw new AggregateError(failures, `فشل إنشاء ${failures.length} فهرس/فهارس`);
  }
};

module.exports = ensureIndexes;
module.exports.indexDefinitionsEquivalent = indexDefinitionsEquivalent;
module.exports.dropObsoleteDonationRequestTtlIndexes = dropObsoleteDonationRequestTtlIndexes;

if (require.main === module) {
  if (!process.env.MONGO_URI) {
    console.error('[Indexes] MONGO_URI مطلوب لتشغيل مهمة الفهارس');
    process.exitCode = 1;
  } else {
    mongoose.connect(process.env.MONGO_URI, { autoIndex: false })
      .then(ensureIndexes)
      .then(() => console.log('[Indexes] اكتملت المهمة بنجاح'))
      .catch((error) => {
        console.error('[Indexes] فشلت المهمة:', error);
        process.exitCode = 1;
      })
      .finally(() => mongoose.disconnect());
  }
}
