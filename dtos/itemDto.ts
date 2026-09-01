// backend/dtos/itemDto.js
// تحقق شكل الطلبات موحّد في middlewares/validateBody.js،
// والتحقق الديناميكي من التصنيفات والمراكز يتم في itemService.


const getReferenceId = (value) => value?._id ?? value ?? null;

const isSameId = (left, right) => (
  left != null && right != null && left.toString() === right.toString()
);

// لا نكشف قائمة الانتظار أو هوية الحاجز للعموم؛ نعيد فقط الحالة اللازمة للواجهة.
exports.toPublicItem = (item, requesterId = null) => ({
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
    : (item.waitlist?.length ?? 0),
  isInWaitlist: requesterId
    ? (item.waitlist ?? []).some(
        (entry) => isSameId(getReferenceId(entry.user), requesterId)
      )
    : false,
  bookingPreviouslyCancelled: requesterId
    ? (item.cancelledBy ?? []).some((id) => isSameId(getReferenceId(id), requesterId))
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
  safeHub: item.safeHub
    ? {
        _id:          getReferenceId(item.safeHub),
        name:         item.safeHub.name,
        address:      item.safeHub.address,
        city:         item.safeHub.city,
        workingHours: item.safeHub.workingHours,
      }
    : null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  donor: item.donor
    ? {
        _id:               getReferenceId(item.donor),
        name:              item.donor.name,
        trustScore:        item.donor.trustScore,
        avatar:            item.donor.avatar,
        isVerifiedStudent: item.donor.isVerifiedStudent,
      }
    : null,
  bookedBy: null,
});


// للمتبرع — يرى بيانات الحاجز (email + phone)
exports.toDonorItem = (item, requesterId = null) => ({
  ...exports.toPublicItem(item, requesterId),
  reportCount: item.reportCount ?? 0,
  reportId: item.reportId ?? null,
  bookedBy: item.bookedBy
    ? {
        _id:   getReferenceId(item.bookedBy),
        name:  item.bookedBy.name,
        phone: item.bookedBy.phone,
        email: item.bookedBy.email,
      }
    : null,
});


// للمستلم — يرى بيانات المتبرع (phone)
exports.toReceiverItem = (item, requesterId = null) => ({
  ...exports.toPublicItem(item, requesterId),
  reportId: item.reportId ?? null,
  bookedBy: item.bookedBy
    ? {
        _id:   getReferenceId(item.bookedBy),
        name:  item.bookedBy.name,
        avatar:item.bookedBy.avatar,
      }
    : null,
  donor: item.donor
    ? {
        _id:               getReferenceId(item.donor),
        name:              item.donor.name,
        phone:             item.donor.phone,
        trustScore:        item.donor.trustScore,
        isVerifiedStudent: item.donor.isVerifiedStudent,
      }
    : null,
});
