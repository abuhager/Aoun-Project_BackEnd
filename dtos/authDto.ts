import { buildGamificationProfile } from '../utils/gamification.js';
import { toId, toIsoDate, toPlainRecord } from './dtoTypes.js';

const toDate = toIsoDate;

export const toAuthUser = (rawUser: unknown) => {
  const user = toPlainRecord(rawUser);
  if (!user) return null;

  return ({
  _id:               toId(user),
  name:              user.name,
  email:             user.email,
  phone:             user.phone             ?? null,
  phoneVerified:     Boolean(user.phoneVerified),
  avatar:            user.avatar            ?? '',
  role:              user.role,
  trustScore:        user.trustScore        ?? 0,
  trustLevel:        user.trustLevel        ?? 1,
  quota:             user.quota             ?? 0,
  totalDonations:    user.totalDonations    ?? 0,
  isVerified:        Boolean(user.isVerified),
  isVerifiedStudent: Boolean(user.isVerifiedStudent),
  isBanned:          Boolean(user.isBanned),
  isFrozen:          Boolean(user.isFrozen),
  badges:            user.badges            ?? [],
  createdAt:         toDate(user.createdAt),
  gamification: buildGamificationProfile(
    user.trustScore,
    user.totalDonations
  ),
  });
};

export const toProfileActivityItem = (rawItem: unknown) => {
  const item = toPlainRecord(rawItem);
  if (!item) return null;

  return ({
  _id:       toId(item),
  title:     item.title,
  category:  item.category,
  status:    item.status,
  imageUrl:  item.imageUrl ?? '',
  // Express يحول Date إلى ISO في JSON؛ إبقاؤه Date داخلياً يحافظ على عقد الخدمة.
  createdAt: item.deliveredAt ?? item.createdAt,
  });
};

export const _private = { toDate, toId };

export default { toAuthUser, toProfileActivityItem, _private };
