const toPlainObject = (value) => (
  value?.toObject ? value.toObject() : value
);

const toId = (value) => {
  if (!value) return null;
  return String(value._id ?? value);
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toPersonReference = (value) => {
  if (!value) return null;
  if (typeof value !== 'object') return toId(value);

  return {
    _id:   toId(value),
    name:  value.name  ?? null,
    email: value.email ?? null,
    title: value.title ?? null,
  };
};

exports.toAdminUser = (rawUser) => {
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

exports.toAdminItem = (rawItem) => {
  const item = toPlainObject(rawItem);
  if (!item) return null;

  return {
    _id:       toId(item),
    title:     item.title,
    category:  item.category,
    status:    item.status,
    imageUrl:  item.imageUrl ?? null,
    createdAt: toDate(item.createdAt),
    donor: item.donor ? {
      _id:   toId(item.donor),
      name:  item.donor.name  ?? null,
      email: item.donor.email ?? null,
    } : null,
  };
};

exports.toAdminAuditLog = (rawLog) => {
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

exports._private = { toDate, toId, toPersonReference };
