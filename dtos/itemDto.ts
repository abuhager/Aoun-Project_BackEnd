// backend/dtos/itemDto.js
// تحقق شكل الطلبات موحّد في middlewares/validateBody.js،
// والتحقق الديناميكي من التصنيفات والمراكز يتم في itemService.
import { asRecord, toPlainRecord } from './dtoTypes.js';

const getReferenceId = (value: unknown) => {
  if (!value) return null;
  const source = asRecord(value);
  return source?._id ?? value;
};

const isSameId = (left: unknown, right: unknown) => (
  left != null && right != null && left.toString() === right.toString()
);

export const toPublicItem = (rawItem: unknown, requesterId: unknown = null) => {
  const item = toPlainRecord(rawItem);
  if (!item) return null;
  const waitlist = Array.isArray(item.waitlist) ? item.waitlist : [];
  const cancelledBy = Array.isArray(item.cancelledBy) ? item.cancelledBy : [];
  const safeHub = asRecord(item.safeHub);
  const donor = asRecord(item.donor);

  return ({
  _id:           item._id,
  title:         item.title,
  description:   item.description,
  category:      item.category,
  location:      item.location,
  condition:     item.condition,
  imageUrl:      item.imageUrl,
  status:        item.status,
  waitlistCount: Number.isInteger(item.waitlistCount)
    ? item.waitlistCount
    : waitlist.length,
  isInWaitlist: requesterId
    ? waitlist.some(
        (rawEntry: unknown) => {
          const entry = asRecord(rawEntry);
          return isSameId(getReferenceId(entry?.user), requesterId);
        }
      )
    : false,
  bookingPreviouslyCancelled: requesterId
    ? cancelledBy.some((id: unknown) => isSameId(getReferenceId(id), requesterId))
    : false,
  bookedAt:            item.bookedAt ?? null,
  recipientConfirmed:  Boolean(item.recipientConfirmed),
  donorConfirmed:      Boolean(item.donorConfirmed),
  recipientConfirmedAt:item.recipientConfirmedAt ?? null,
  donorConfirmedAt:    item.donorConfirmedAt ?? null,
  deliveredAt:         item.deliveredAt ?? null,
  expiryHours:         item.expiryHours,
  isRated:             Boolean(item.isRated),
  linkedRequestId:     item.linkedRequestId ?? null,
  safeHub: safeHub
    ? {
        _id:          getReferenceId(safeHub),
        name:         safeHub.name,
        address:      safeHub.address,
        city:         safeHub.city,
        workingHours: safeHub.workingHours,
      }
    : null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  donor: donor
    ? {
        _id:               getReferenceId(donor),
        name:              donor.name,
        trustScore:        donor.trustScore,
        avatar:            donor.avatar,
        isVerifiedStudent: donor.isVerifiedStudent,
      }
    : null,
  bookedBy: null,
  });
};

export const toDonorItem = (rawItem: unknown, requesterId: unknown = null) => {
  const item = toPlainRecord(rawItem);
  if (!item) return null;
  const bookedBy = asRecord(item.bookedBy);

  return ({
  ...toPublicItem(item, requesterId),
  reportCount: item.reportCount ?? 0,
  reportId: item.reportId ?? null,
  bookedBy: bookedBy
    ? {
        _id:   getReferenceId(bookedBy),
        name:  bookedBy.name,
        phone: bookedBy.phone,
        email: bookedBy.email,
      }
    : null,
  });
};

export const toReceiverItem = (rawItem: unknown, requesterId: unknown = null) => {
  const item = toPlainRecord(rawItem);
  if (!item) return null;
  const bookedBy = asRecord(item.bookedBy);
  const donor = asRecord(item.donor);

  return ({
  ...toPublicItem(item, requesterId),
  reportId: item.reportId ?? null,
  bookedBy: bookedBy
    ? {
        _id:   getReferenceId(bookedBy),
        name:  bookedBy.name,
        avatar:bookedBy.avatar,
      }
    : null,
  donor: donor
    ? {
        _id:               getReferenceId(donor),
        name:              donor.name,
        phone:             donor.phone,
        trustScore:        donor.trustScore,
        isVerifiedStudent: donor.isVerifiedStudent,
      }
    : null,
  });
};

export default { toPublicItem, toDonorItem, toReceiverItem };
