import { asRecord, toId, toIsoDate, toPlainRecord } from './dtoTypes.js';

const toPlainObject = toPlainRecord;
const toDate = toIsoDate;

const toPersonReference = (value: unknown) => {
  if (!value) return null;
  if (typeof value !== 'object') return toId(value);

  const person = asRecord(value);
  if (!person) return null;

  return {
    _id:   toId(person),
    name:  person.name  ?? null,
    email: person.email ?? null,
    title: person.title ?? null,
  };
};

export const toAdminUser = (rawUser: unknown) => {
  const user = toPlainObject(rawUser);
  if (!user) return null;

  return {
    _id:               toId(user),
    name:              user.name,
    email:             user.email,
    phone:             user.phone             ?? null,
    avatar:            user.avatar            ?? '',
    role:              user.role,
    trustLevel:        user.trustLevel        ?? 1,
    trustScore:        user.trustScore        ?? 0,
    quota:             user.quota             ?? 0,
    totalDonations:    user.totalDonations    ?? 0,
    isVerified:        Boolean(user.isVerified),
    isVerifiedStudent: Boolean(user.isVerifiedStudent),
    phoneVerified:     Boolean(user.phoneVerified),
    isBanned:          Boolean(user.isBanned),
    isFrozen:          Boolean(user.isFrozen),
    banReason:         user.banReason         ?? null,
    createdAt:         toDate(user.createdAt),
    updatedAt:         toDate(user.updatedAt),
  };
};

export const toAdminItem = (rawItem: unknown) => {
  const item = toPlainObject(rawItem);
  if (!item) return null;

  const donor = asRecord(item.donor);

  return {
    _id:       toId(item),
    title:     item.title,
    category:  item.category,
    status:    item.status,
    imageUrl:  item.imageUrl ?? null,
    createdAt: toDate(item.createdAt),
    donor: donor ? {
      _id:   toId(donor),
      name:  donor.name  ?? null,
      email: donor.email ?? null,
    } : null,
  };
};

export const toAdminAuditLog = (rawLog: unknown) => {
  const log = toPlainObject(rawLog);
  if (!log) return null;

  return {
    _id:         toId(log),
    adminId:     toPersonReference(log.adminId),
    action:      log.action,
    targetId:    toPersonReference(log.targetId),
    targetModel: log.targetModel ?? null,
    targetName:  log.targetName  ?? null,
    details:     log.details     ?? null,
    reason:      log.reason      ?? null,
    adminNote:   log.adminNote   ?? null,
    meta:        log.meta        ?? {},
    createdAt:   toDate(log.createdAt),
  };
};

export const _private = { toDate, toId, toPersonReference };

export default { toAdminUser, toAdminItem, toAdminAuditLog, _private };
