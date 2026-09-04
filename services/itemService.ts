// services/itemService.js
// ✅ PATCHED v3 — إصلاحات Flow 5 Review
// FIX [CANCEL-01]: cancelBookingLogic تستخدم findOneAndUpdate ذري بدل findById + save
// FIX [SESSION-01]: session.endSession() في finally بدل التكرار

const mongoose        = require('mongoose');
const Item            = require('../models/Item');
const User            = require('../models/User');
const SystemSettings  = require('../models/SystemSettings');
const DonationRequest = require('../models/DonationRequest');
const SafeHub         = require('../models/SafeHub');

const itemRepository  = require('../repositories/itemRepository');
const AppError        = require('../utils/AppError');

const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require('../utils/uploadToCloudinary');
const notifyUser             = require('../utils/notifyUser');
const escapeRegex            = require('../utils/escapeRegex');
const { validateImageFile }  = require('../utils/imageValidation');
const { toPublicItem, toDonorItem, toReceiverItem } = require('../dtos/itemDto');
const { buildGamificationProfile } = require('../utils/gamification');
const { SOCKET_EVENTS }      = require('../socket/contracts');
const { emitToAll, emitToUser } = require('../socket/emitter');
import type { EntityId, ServicePayload, UploadedFile } from './serviceTypes';
import { getErrorMessage } from './serviceTypes';

// ── ✅ ARCH-01: ثوابت مشتركة ────────────────────────────────────────────────
const DEFAULT_MAX_WAITLIST = 10;

type ItemListQuery = {
  page?: string | number;
  limit?: string | number;
  location?: string;
  search?: string;
  category?: string;
  availableOnly?: string | boolean;
};

type EntityReference = EntityId | { _id?: EntityId | null };
type WaitlistEntry = {
  user: EntityReference;
  joinedAt?: Date | string;
};
type ItemLifecycle = {
  linkedRequestId?: EntityReference | null;
  donor?: EntityReference | null;
  bookedBy?: EntityReference | null;
  waitlist?: WaitlistEntry[];
  cancelledBy?: EntityId[];
};
type NotificationPayload = ServicePayload & { type: string };
type ItemInput = {
  title: string;
  description?: string;
  category: string;
  location: string;
  condition: string;
  safeHub?: EntityId | null;
};
type ItemUpdateInput = ServicePayload & Partial<ItemInput>;
type DeliveryConfirmation = 'recipient_confirm' | 'donor_confirm';

const resolveEntityId = (value: EntityReference): EntityId | undefined => {
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return value._id ?? undefined;
  }
  return value as EntityId;
};

const queueNotification = (
  userId: EntityId | null | undefined,
  payload: NotificationPayload
) => {
  if (!userId) return;
  setImmediate(() => {
    notifyUser(userId, payload).catch((error: unknown) => {
      console.warn(`[Items] تعذر إرسال إشعار ${payload.type}:`, getErrorMessage(error));
    });
  });
};

const resetDeliveryState = () => ({
  recipientConfirmed:   false,
  recipientConfirmedAt: null,
  donorConfirmed:       false,
  donorConfirmedAt:     null,
  deliveredAt:          null,
  reminderSent:         false,
});

const findNextEligibleWaitlistCandidate = async (
  waitlist: WaitlistEntry[] | null | undefined,
  itemId: EntityId,
  maxBookings: number,
  excludedUserIds: EntityReference[] = []
) => {
  const skippedUserIds: EntityId[] = [];
  const excluded = new Set(
    excludedUserIds
      .map(resolveEntityId)
      .filter((id): id is EntityId => Boolean(id))
      .map((id) => id.toString())
  );

  for (const entry of waitlist ?? []) {
    const candidateId = resolveEntityId(entry.user);
    if (!candidateId || excluded.has(candidateId.toString())) {
      if (candidateId) skippedUserIds.push(candidateId);
      continue;
    }
    const candidate = await User.findOne({
      _id: candidateId,
      role: { $nin: ['admin', 'super_admin'] },
      isVerified: true,
      isBanned: { $ne: true },
      isFrozen: { $ne: true },
      trustLevel: { $gte: 2 },
    }).select('_id name email').lean();

    if (!candidate) {
      skippedUserIds.push(candidateId);
      continue;
    }

    const activeBookings = await Item.countDocuments({
      _id: { $ne: itemId },
      bookedBy: candidate._id,
      status: 'محجوز',
    });

    if (activeBookings < maxBookings) {
      return { candidate, skippedUserIds };
    }

    skippedUserIds.push(candidateId);
  }

  return { candidate: null, skippedUserIds };
};

const isAdminRole = (role: string) => ['admin', 'super_admin'].includes(role);

const assertGenericLifecycleAllowed = (
  item: ItemLifecycle | null | undefined,
  userId: EntityId | null | undefined
) => {
  if (!item?.linkedRequestId) return;

  const isParticipant = [item.donor, item.bookedBy].some(
    (value) => value && userId && value.toString() === userId.toString()
  );

  if (!isParticipant)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  throw new AppError(
    'هذا الغرض مخصص لطلب تبرع مقبول ولا يمكن إدارة حجزه من المسار العام',
    409,
    'REQUEST_LINKED_ITEM_LOCKED'
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. جلب الأغراض المتاحة
// ─────────────────────────────────────────────────────────────────────────────
exports.getItemsLogic = async (query: ItemListQuery = {}) => {
  const page        = Math.max(1, parseInt(String(query.page ?? ''), 10) || 1);
  const settings    = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit       = Math.min(
    maxPageSize,
    Math.max(1, parseInt(String(query.limit ?? ''), 10) || 10)
  );
  const skip        = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    status: { $in: ['متاح', 'محجوز'] },
    linkedRequestId: null,
  };

  if (query.location)    filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search)      filter.title    = new RegExp(escapeRegex(query.search),    'i');
  if (query.category && query.category !== 'all') filter.category = query.category;

  if (query.availableOnly === 'true') filter.status = 'متاح';

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor',   'name avatar trustScore isVerifiedStudent trustLevel')
      .populate('safeHub', 'name address city workingHours')
      .sort({ status: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-cancelledBy -cloudinaryId -__v')
      .lean(),
    Item.countDocuments(filter),
  ]);

  return {
    items: items.map((item: unknown) => toPublicItem(item)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. جلب أغراضي
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyItemsLogic = async (userId: EntityId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId)
      .select(
        'name email avatar trustScore trustLevel quota totalDonations ' +
        'isVerifiedStudent badges'
      )
      .lean(),
    itemRepository.findDonationsByUser(userId),
    itemRepository.findReceivedByUser(userId),
  ]);

  const safeUser = user
    ? {
        ...user,
        gamification: buildGamificationProfile(user.trustScore, user.totalDonations),
      }
    : null;

  return {
    user: safeUser,
    myDonations: myDonations.map((item: unknown) => toDonorItem(item, userId)),
    myRequests: myRequests.map((item: unknown) => toReceiverItem(item, userId)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. جلب غرض بالـ ID
// ─────────────────────────────────────────────────────────────────────────────
exports.getItemByIdLogic = async (
  itemId: EntityId,
  requesterId: EntityId | null,
  requesterRole = 'user'
) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const settings = await SystemSettings.getCached();
  const obj      = item.toObject ? item.toObject() : { ...item };

  obj.expiryHours   = settings.bookingExpiryHours ?? 72;
  obj.waitlistCount = obj.waitlist?.length ?? 0;

  const isOwner     = requesterId && obj.donor?._id?.toString() === requesterId.toString();
  const isBookerReq = requesterId && obj.bookedBy?._id?.toString() === requesterId.toString();
  const isAdmin     = isAdminRole(requesterRole);

  if (obj.linkedRequestId && !isOwner && !isBookerReq && !isAdmin)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (obj.status === 'مخفي' && !isOwner && !isAdmin)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (isOwner || isAdmin) {
    const result = toDonorItem(obj, requesterId);
    delete result.waitlist;
    return result;
  }

  if (isBookerReq) {
    const result = toReceiverItem(obj, requesterId);
    delete result.waitlist;
    return result;
  }

  const result = toPublicItem(obj, requesterId);
  delete result.waitlist;
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. إضافة غرض جديد
// ─────────────────────────────────────────────────────────────────────────────
exports.createItemLogic = async (
  body: ItemInput,
  userId: EntityId,
  file: UploadedFile
) => {
  validateImageFile(file, { required: true });

  const [user, settings, activeCount, safeHub] = await Promise.all([
    User.findById(userId).select('isVerified trustLevel quota').lean(),
    SystemSettings.getCached(),
    Item.countDocuments({ donor: userId, status: { $in: ['متاح', 'محجوز'] } }),
    body.safeHub
      ? SafeHub.findOne({ _id: body.safeHub, isActive: { $ne: false } }).lean()
      : Promise.resolve(null),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (!user.isVerified)
    throw new AppError('يجب تفعيل الحساب أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');
  const minTrustLevel = settings.minTrustLevelForDonating ?? 1;
  if ((user.trustLevel ?? 0) < minTrustLevel)
    throw new AppError(
      `يلزم Level ${minTrustLevel} على الأقل لنشر تبرع`,
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );
  if (settings.requireHubForBooking && !body.safeHub)
    throw new AppError('يجب اختيار نقطة استلام آمنة', 400, 'SAFE_HUB_REQUIRED');
  if (body.safeHub && !safeHub)
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');
  if (body.category && !settings.categories?.includes(body.category))
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');

  const maxItems =
    user.trustLevel >= 2
      ? (settings.maxActiveDonationsLevel2Plus ?? 4)
      : (settings.maxActiveDonationsPerUser    ?? 2);

  if (activeCount >= maxItems)
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`,
      429,
      'MAX_ACTIVE_ITEMS_REACHED'
    );

  const uploadResult = await uploadToCloudinary(file.buffer);
  let item;

  try {
    item = await Item.create({
      title:        body.title?.trim(),
      description:  body.description?.trim(),
      category:     body.category,
      location:     body.location?.trim(),
      condition:    body.condition,
      safeHub:      safeHub?._id ?? null,
      donor:        userId,
      imageUrl:     uploadResult.secure_url,
      cloudinaryId: uploadResult.public_id,
    });
  } catch (err) {
    try {
      await deleteFromCloudinary(uploadResult.public_id);
    } catch (cleanupError: unknown) {
      console.warn(
        '[Cloudinary] تعذر حذف صورة غرض فشل إنشاؤه:',
        getErrorMessage(cleanupError)
      );
    }
    throw err;
  }

  await item.populate([
    { path: 'donor', select: 'name avatar trustScore isVerifiedStudent trustLevel' },
    { path: 'safeHub', select: 'name address city workingHours' },
  ]);

  setImmediate(async () => {
    try {
      const requests = await DonationRequest.find({
        category: item.category,
        status:   'active',
        expiresAt: { $gt: new Date() },
        requester: { $ne: userId },
      }).select('requester').lean();

      const uniqueUsers = [...new Set(requests.map(
        (request: { requester: EntityId }) => request.requester.toString()
      ))];
      await Promise.allSettled(
        uniqueUsers.map((uid) =>
          notifyUser(uid, {
            type:      'matching_item',
            title:     'غرض جديد يطابق طلبك 🎁',
            body:      `غرض جديد من فئة "${item.category}" متاح الآن.`,
            itemId:    item._id,
            actionUrl: `/items/${item._id}`,
          })
        )
      );
    } catch (_) {}
  });

  return { item: toDonorItem(item.toObject(), userId) };
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. حجز غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.bookItemLogic = async (itemId: EntityId, userId: EntityId) => {
  const [user, settings, snapshot] = await Promise.all([
    User.findById(userId).select('isVerified trustLevel role').lean(),
    SystemSettings.getCached(),
    Item.findById(itemId)
      .select('status donor bookedBy waitlist cancelledBy linkedRequestId safeHub')
      .lean(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  if (!snapshot)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  assertGenericLifecycleAllowed(snapshot, userId);

  if (!user.isVerified)
    throw new AppError('يجب تفعيل الحساب أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');

  if (isAdminRole(user.role))
    throw new AppError(
      'حسابات الإدارة مخصصة للإشراف ولا يمكنها حجز الأغراض',
      403,
      'ADMIN_BOOKING_FORBIDDEN'
    );

  if ((user.trustLevel ?? 0) < 2)
    throw new AppError(
      'يجب الترقية إلى المستوى الثاني للحجز 🔒',
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );

  if (settings.requireHubForBooking && !snapshot.safeHub)
    throw new AppError(
      'هذا الغرض يحتاج إلى نقطة استلام قبل حجزه',
      409,
      'SAFE_HUB_REQUIRED'
    );

  if (snapshot.donor.toString() === userId.toString())
    throw new AppError('لا يمكنك حجز غرضك الخاص', 400, 'CANNOT_BOOK_OWN_ITEM');

  if (snapshot.bookedBy?.toString() === userId.toString())
    throw new AppError('أنت حاجز هذا الغرض بالفعل', 409, 'ALREADY_BOOKED');

  const wasCancelled = snapshot.cancelledBy?.some(
    (id: EntityId) => id.toString() === userId.toString()
  );
  if (wasCancelled)
    throw new AppError(
      'ألغيت حجزك لهذا الغرض — لا يمكن حجزه أو الانضمام لقائمة انتظاره مجدداً',
      403,
      'BOOKING_PREVIOUSLY_CANCELLED'
    );

  const maxBookings = settings.maxBookingsPerUser ?? 3;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  if (snapshot.status === 'متاح') {
    const currentBookings = await Item.countDocuments({
      bookedBy: userId,
      status:   'محجوز',
    });

    if (currentBookings >= maxBookings)
      throw new AppError(
        `وصلت للحد الأقصى (${maxBookings} حجوزات نشطة)`,
        429,
        'MAX_BOOKINGS_REACHED'
      );

    const item = await Item.findOneAndUpdate(
      {
        _id:      itemId,
        status:   'متاح',
        donor:    { $ne: userObjectId },
        bookedBy: null,
        linkedRequestId: null,
        cancelledBy: { $ne: userObjectId },
      },
      {
        $set: {
          status:   'محجوز',
          bookedBy: userId,
          bookedAt: new Date(),
          ...resetDeliveryState(),
        },
        $pull: { waitlist: { user: userObjectId } },
      },
      { returnDocument: 'after', runValidators: true }
    ).populate('donor', 'name email');

    if (!item)
      throw new AppError(
        'تم حجز الغرض من مستخدم آخر؛ حدّث الصفحة للانضمام إلى قائمة الانتظار',
        409,
        'ITEM_JUST_BOOKED'
      );

    emitToUser(item.donor._id, SOCKET_EVENTS.ITEM_BOOKED, {
      itemId: item._id,
      bookedBy: userId,
    });
    queueNotification(item.donor._id, {
      type:      'item_booked',
      title:     'تم حجز غرضك 📦',
      body:      `تم حجز "${item.title}". افتح الغرض للتواصل مع المستلم.`,
      itemId:    item._id,
      actionUrl: `/items/${item._id}`,
    });

    return {
      msg:        'تم حجز الغرض بنجاح ✅',
      itemId:     item._id,
      status:     item.status,
      waitlisted: false,
    };
  }

  if (snapshot.status === 'محجوز') {
    const maxWaitlist = settings.maxWaitlistPerItem ?? DEFAULT_MAX_WAITLIST;
    const waitlist = snapshot.waitlist ?? [];

    if (waitlist.length >= maxWaitlist)
      throw new AppError(
        `قائمة الانتظار ممتلئة (الحد الأقصى ${maxWaitlist})`,
        429,
        'WAITLIST_FULL'
      );

    const alreadyIn = waitlist.some(
      (entry: WaitlistEntry) => entry.user.toString() === userId.toString()
    );
    if (alreadyIn)
      throw new AppError(
        'أنت مسجل في قائمة الانتظار بالفعل',
        400,
        'ALREADY_WAITLISTED'
      );

    const updated = await Item.findOneAndUpdate(
      {
        _id:         itemId,
        status:      'محجوز',
        bookedBy:    { $ne: userObjectId },
        donor:       { $ne: userObjectId },
        linkedRequestId: null,
        cancelledBy: { $ne: userObjectId },
        'waitlist.user': { $ne: userObjectId },
        $expr: {
          $lt: [
            { $size: { $ifNull: ['$waitlist', []] } },
            maxWaitlist,
          ],
        },
      },
      { $push: { waitlist: { user: userId, joinedAt: new Date() } } },
      { returnDocument: 'after' }
    );

    if (!updated)
      throw new AppError('تعذر الانضمام؛ حدّث الصفحة وحاول مجدداً', 409, 'WAITLIST_CONFLICT');

    const position = updated.waitlist.length;

    return {
      msg:        `✅ تمت إضافتك لقائمة الانتظار (المركز ${position})`,
      waitlisted: true,
      position,
      itemId,
    };
  }

  throw new AppError('الغرض غير متاح للحجز', 409, 'ITEM_NOT_AVAILABLE');
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. مغادرة قائمة الانتظار
// ─────────────────────────────────────────────────────────────────────────────
exports.leaveWaitlistLogic = async (itemId: EntityId, userId: EntityId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const updated = await Item.findOneAndUpdate(
    {
      _id: itemId,
      bookedBy: { $ne: userObjectId },
      linkedRequestId: null,
      'waitlist.user': userObjectId,
    },
    { $pull: { waitlist: { user: userObjectId } } },
    { returnDocument: 'after' }
  );

  if (updated) {
    return {
      msg: 'تم إلغاء تسجيلك من قائمة الانتظار ✅',
      itemId,
      waitlisted: false,
      waitlistCount: updated.waitlist?.length ?? 0,
    };
  }

  const snapshot = await Item.findById(itemId)
    .select('donor bookedBy waitlist linkedRequestId')
    .lean();
  if (!snapshot)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  assertGenericLifecycleAllowed(snapshot, userId);
  if (snapshot.bookedBy?.toString() === userId.toString())
    throw new AppError('أنت الحاجز الفعلي؛ استخدم إلغاء الحجز', 400, 'USE_CANCEL_BOOKING');
  throw new AppError('أنت لست في قائمة الانتظار', 400, 'NOT_IN_WAITLIST');
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. إلغاء الحجز ونقل الدور إن أمكن
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelBookingLogic = async (itemId: EntityId, userId: EntityId) => {
  const snapshot = await Item.findById(itemId)
    .select('status donor bookedBy waitlist cancelledBy title recipientConfirmed linkedRequestId')
    .lean();

  if (!snapshot) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  assertGenericLifecycleAllowed(snapshot, userId);

  const isBooker = snapshot.bookedBy?.toString() === userId;
  const isDonor  = snapshot.donor?.toString()    === userId;
  const inWait   = snapshot.waitlist?.some(
    (entry: WaitlistEntry) => entry.user.toString() === userId.toString()
  );

  if (!isBooker && !isDonor && !inWait)
    throw new AppError('ليس لديك صلاحية إلغاء هذا الحجز', 403, 'FORBIDDEN');

  if (inWait && !isBooker && !isDonor) {
    return exports.leaveWaitlistLogic(itemId, userId);
  }

  if (snapshot.status !== 'محجوز' || !snapshot.bookedBy)
    throw new AppError('لا يوجد حجز نشط لإلغائه', 409, 'NO_ACTIVE_BOOKING');
  if (snapshot.recipientConfirmed)
    throw new AppError(
      'لا يمكن إلغاء الحجز بعد تأكيد الاستلام؛ بانتظار تأكيد المتبرع',
      409,
      'HANDOVER_CONFIRMATION_IN_PROGRESS'
    );

  const settings = await SystemSettings.getCached();
  const maxBookings = settings.maxBookingsPerUser ?? 3;
  const oldBookerId = snapshot.bookedBy;
  const { candidate, skippedUserIds } = await findNextEligibleWaitlistCandidate(
    snapshot.waitlist,
    itemId,
    maxBookings,
    [snapshot.donor, oldBookerId, ...(snapshot.cancelledBy ?? [])]
  );

  if (candidate) {
    const removedWaitlistIds = [...skippedUserIds, candidate._id];
    const promoted = await Item.findOneAndUpdate(
      {
        _id:      itemId,
        status:   'محجوز',
        bookedBy: oldBookerId,
        linkedRequestId: null,
        recipientConfirmed: false,
      },
      {
        $set: {
          bookedBy: candidate._id,
          bookedAt: new Date(),
          status: 'محجوز',
          ...resetDeliveryState(),
        },
        $pull: { waitlist: { user: { $in: removedWaitlistIds } } },
        $addToSet: { cancelledBy: oldBookerId },
      },
      { returnDocument: 'after' }
    )
      .populate('donor', 'name email')
      .populate('bookedBy', 'name');

    if (!promoted)
      throw new AppError('تعذّر إلغاء الحجز — حاول مرة أخرى', 409, 'CANCEL_CONFLICT');

    emitToUser(candidate._id, SOCKET_EVENTS.ITEM_WAITLIST_PROMOTED, {
      itemId: promoted._id,
      status: promoted.status,
    });
    emitToUser(promoted.donor._id, SOCKET_EVENTS.ITEM_BOOKING_TRANSFERRED, {
      itemId: promoted._id,
      bookedBy: candidate._id,
    });
    queueNotification(candidate._id, {
      type:      'waitlist_promoted',
      title:     'وصل دورك الآن 🎉',
      body:      `أصبح "${promoted.title}" محجوزاً لك. تواصل مع المتبرع لإتمام الاستلام.`,
      itemId:    promoted._id,
      actionUrl: `/items/${promoted._id}`,
    });
    queueNotification(promoted.donor._id, {
      type:      'booking_transferred',
      title:     'تم نقل الحجز تلقائياً 🔄',
      body:      `انتقل حجز "${promoted.title}" إلى أول مستخدم مؤهل في قائمة الانتظار.`,
      itemId:    promoted._id,
      actionUrl: `/items/${promoted._id}`,
    });

    if (isDonor && oldBookerId.toString() !== userId.toString()) {
      emitToUser(oldBookerId, SOCKET_EVENTS.ITEM_BOOKING_CANCELLED, {
        itemId: promoted._id,
      });
      queueNotification(oldBookerId, {
        type:      'booking_cancelled',
        title:     'تم إلغاء حجزك',
        body:      `ألغى المتبرع حجز "${promoted.title}".`,
        itemId:    promoted._id,
        actionUrl: `/items/${promoted._id}`,
      });
    }

    return {
      msg: 'تم إلغاء الحجز وترقية أول مستخدم مؤهل في قائمة الانتظار ✅',
      itemId: promoted._id,
      status: promoted.status,
      promoted: true,
      bookedBy: promoted.bookedBy
        ? { _id: promoted.bookedBy._id, name: promoted.bookedBy.name }
        : null,
    };
  }

  const releaseUpdate: {
    $set: Record<string, unknown>;
    $addToSet: Record<string, unknown>;
    $pull?: Record<string, unknown>;
  } = {
    $set: {
      status: 'متاح',
      bookedBy: null,
      bookedAt: null,
      ...resetDeliveryState(),
    },
    $addToSet: { cancelledBy: oldBookerId },
  };
  if (skippedUserIds.length > 0) {
    releaseUpdate.$pull = { waitlist: { user: { $in: skippedUserIds } } };
  }

  const released = await Item.findOneAndUpdate(
    {
      _id:      itemId,
      status:   'محجوز',
      bookedBy: oldBookerId,
      linkedRequestId: null,
      recipientConfirmed: false,
    },
    releaseUpdate,
    { returnDocument: 'after' }
  ).populate('donor', 'name email');

  if (!released)
    throw new AppError('تعذّر إلغاء الحجز — حاول مرة أخرى', 409, 'CANCEL_CONFLICT');

  emitToUser(released.donor._id, SOCKET_EVENTS.ITEM_BOOKING_CANCELLED, {
    itemId: released._id,
    status: released.status,
  });
  queueNotification(released.donor._id, {
    type:      'booking_cancelled',
    title:     'تم إلغاء الحجز',
    body:      `عاد "${released.title}" متاحاً للحجز.`,
    itemId:    released._id,
    actionUrl: `/items/${released._id}`,
  });

  if (isDonor && oldBookerId.toString() !== userId.toString()) {
    emitToUser(oldBookerId, SOCKET_EVENTS.ITEM_BOOKING_CANCELLED, {
      itemId: released._id,
      status: released.status,
    });
    queueNotification(oldBookerId, {
      type:      'booking_cancelled',
      title:     'تم إلغاء حجزك',
      body:      `ألغى المتبرع حجز "${released.title}".`,
      itemId:    released._id,
      actionUrl: `/items/${released._id}`,
    });
  }

  return {
    msg: 'تم إلغاء الحجز وإعادة الغرض متاحاً ✅',
    itemId: released._id,
    status: released.status,
    promoted: false,
    bookedBy: null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. تأكيد التسليم المزدوج
// ✅ FIX [SESSION-01]: session.endSession() في finally بدل التكرار
// ─────────────────────────────────────────────────────────────────────────────
exports.completeDeliveryLogic = async (
  itemId: EntityId,
  userId: EntityId,
  confirmationType: DeliveryConfirmation
) => {
  if (!userId) throw new AppError('المستخدم غير معرّف', 401, 'UNAUTHORIZED');

  const userObjectId = typeof userId === 'string'
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const userIdStr = userId.toString();

  // ── تأكيد المستلم ────────────────────────────────────────────────────────
  if (confirmationType === 'recipient_confirm') {
    const item = await Item.findOneAndUpdate(
      {
        _id:                itemId,
        status:             'محجوز',
        bookedBy:           userObjectId,
        recipientConfirmed: false,
      },
      {
        $set: {
          recipientConfirmed:   true,
          recipientConfirmedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    ).populate('donor', 'name email');

    if (!item) {
      const exists = await Item.findById(itemId)
        .select('status bookedBy recipientConfirmed').lean();
      if (!exists)
        throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
      if (exists.bookedBy?.toString() === userIdStr && exists.recipientConfirmed)
        throw new AppError('لقد قمت بالتأكيد مسبقاً ✅', 400, 'ALREADY_CONFIRMED');
      if (exists.bookedBy?.toString() !== userIdStr)
        throw new AppError('ليس لديك صلاحية تأكيد الاستلام', 403, 'FORBIDDEN');
      if (exists.status !== 'محجوز')
        throw new AppError('الغرض ليس في حالة الحجز', 400, 'INVALID_STATUS');
      throw new AppError('تعذر تأكيد الاستلام', 400, 'CONFIRM_FAILED');
    }

    emitToUser(item.donor._id, SOCKET_EVENTS.ITEM_RECIPIENT_CONFIRMED, {
      itemId:    item._id,
      itemTitle: item.title,
      message:   '✅ المستلم أكّد الاستلام — بانتظار تأكيدك أنت',
    });
    queueNotification(item.donor._id, {
      type:      'recipient_confirmed',
      title:     'المستلم أكّد الاستلام ✅',
      body:      `أكّد تسليم "${item.title}" لإتمام العملية.`,
      itemId:    item._id,
      actionUrl: `/items/${item._id}`,
    });

    return {
      status: 'pending_donor',
      msg:    'تم تأكيد الاستلام ✅ — بانتظار تأكيد المتبرع',
      itemId: item._id,
    };
  }

  // ── تأكيد المتبرع (Transaction) ──────────────────────────────────────────
  if (confirmationType === 'donor_confirm') {
    const settings = await SystemSettings.getCached();
    const trustReward = settings.trustScorePerDonation ?? 5;
    const quotaReward = settings.donorQuotaReward ?? 1;
    const session = await mongoose.startSession();
    let deliveredItem;

    try {
      session.startTransaction();

      deliveredItem = await Item.findOneAndUpdate(
        {
          _id:                itemId,
          status:             'محجوز',
          donor:              userObjectId,
          recipientConfirmed: true,
          donorConfirmed:     false,
        },
        {
          $set: {
            donorConfirmed:   true,
            donorConfirmedAt: new Date(),
            status:           'تم التسليم',
            deliveredAt:      new Date(),
          },
        },
        { returnDocument: 'after', session }
      ).populate('donor bookedBy', 'name email trustScore quota totalDonations');

      if (!deliveredItem) {
        const exists = await Item.findById(itemId)
          .select('status donor recipientConfirmed donorConfirmed bookedBy').lean();
        if (!exists)
          throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
        if (exists.donor?.toString() !== userIdStr)
          throw new AppError('ليس لديك صلاحية تأكيد التسليم', 403, 'FORBIDDEN');
        if (!exists.recipientConfirmed)
          throw new AppError('بانتظار تأكيد المستلم أولاً ⏳', 400, 'RECIPIENT_NOT_CONFIRMED');
        if (exists.donorConfirmed)
          throw new AppError('لقد قمت بالتأكيد مسبقاً ✅', 400, 'ALREADY_CONFIRMED');
        throw new AppError('تعذر تأكيد التسليم', 400, 'CONFIRM_FAILED');
      }

      await User.findByIdAndUpdate(
        deliveredItem.donor._id,
        {
          $inc: {
            trustScore: trustReward,
            totalDonations: 1,
            quota: quotaReward,
          },
        },
        { session }
      );

      await session.commitTransaction();

    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      throw err;
    } finally {
      // ✅ FIX [SESSION-01]: endSession مرة واحدة في finally
      try { session.endSession(); } catch (_) {}
    }

    emitToUser(deliveredItem.bookedBy._id, SOCKET_EVENTS.ITEM_DELIVERED, {
      itemId:    deliveredItem._id,
      itemTitle: deliveredItem.title,
      message:   '🎉 تم تأكيد التسليم من المتبرع — العملية مكتملة!',
    });
    queueNotification(deliveredItem.bookedBy._id, {
      type:      'delivery_completed',
      title:     'اكتملت عملية التسليم 🎉',
      body:      `تم تأكيد تسليم "${deliveredItem.title}" بنجاح.`,
      itemId:    deliveredItem._id,
      actionUrl: `/items/${deliveredItem._id}`,
    });
    emitToAll(SOCKET_EVENTS.LEADERBOARD_UPDATE, {
      userId: deliveredItem.donor._id.toString(),
    });

    return {
      status: 'delivered',
      msg:    'تم تأكيد التسليم بنجاح 🎉',
      itemId: deliveredItem._id,
    };
  }

  throw new AppError('نوع التأكيد غير معروف', 400, 'INVALID_CONFIRMATION_TYPE');
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. تعديل غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.updateItemLogic = async (
  itemId: EntityId,
  userId: EntityId,
  body: ItemUpdateInput = {},
  file: UploadedFile | null = null
) => {
  const snapshot = await Item.findById(itemId)
    .select('donor status cloudinaryId')
    .lean();

  if (!snapshot)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (snapshot.donor?.toString() !== userId?.toString())
    throw new AppError('ليس لديك صلاحية تعديل هذا الغرض', 403, 'FORBIDDEN');

  if (!['متاح', 'مخفي'].includes(snapshot.status))
    throw new AppError(
      'لا يمكن تعديل الغرض بعد حجزه أو تسليمه',
      409,
      'ITEM_NOT_EDITABLE'
    );

  const needsSettings = Boolean(body.category) || Object.hasOwn(body, 'safeHub');
  const settings = needsSettings ? await SystemSettings.getCached() : null;

  if (body.category) {
    if (!settings.categories?.includes(body.category))
      throw new AppError(
        `التصنيف "${body.category}" غير مدعوم`,
        400,
        'INVALID_CATEGORY'
      );
  }

  if (Object.hasOwn(body, 'safeHub') && settings?.requireHubForBooking && !body.safeHub) {
    throw new AppError('يجب اختيار نقطة استلام آمنة', 400, 'SAFE_HUB_REQUIRED');
  }

  if (body.safeHub) {
    // المراكز القديمة التي لا تحتوي isActive تُعامل كمفعّلة للتوافق مع البيانات الحالية.
    const safeHub = await SafeHub.findOne({
      _id: body.safeHub,
      isActive: { $ne: false },
    }).select('_id').lean();

    if (!safeHub)
      throw new AppError(
        'نقطة الاستلام غير موجودة أو غير مفعّلة',
        400,
        'INVALID_SAFE_HUB'
      );
  }

  const allowedFields = [
    'title',
    'description',
    'category',
    'location',
    'condition',
    'safeHub',
  ];
  const updates: ServicePayload = {};

  for (const field of allowedFields) {
    if (!Object.hasOwn(body, field)) continue;
    const value = body[field];
    if (field === 'safeHub') {
      updates[field] = value || null;
    } else {
      updates[field] = typeof value === 'string' ? value.trim() : value;
    }
  }

  let uploadedImage = null;

  if (file) {
    validateImageFile(file);
    uploadedImage = await uploadToCloudinary(file.buffer);
    updates.imageUrl = uploadedImage.secure_url;
    updates.cloudinaryId = uploadedImage.public_id;
  }

  if (Object.keys(updates).length === 0)
    throw new AppError('لا توجد تعديلات للحفظ', 400, 'NO_CHANGES');

  let updatedItem;

  try {
    updatedItem = await Item.findOneAndUpdate(
      {
        _id: itemId,
        donor: userId,
        status: { $in: ['متاح', 'مخفي'] },
      },
      { $set: updates },
      { returnDocument: 'after', runValidators: true }
    ).populate([
      {
        path: 'donor',
        select: 'name avatar trustScore isVerifiedStudent trustLevel',
      },
      {
        path: 'safeHub',
        select: 'name address city workingHours',
      },
    ]);
  } catch (err) {
    if (uploadedImage?.public_id) {
      try {
        await deleteFromCloudinary(uploadedImage.public_id);
      } catch (cleanupError: unknown) {
        console.warn(
          '[Cloudinary] تعذر حذف الصورة الجديدة بعد فشل التعديل:',
          getErrorMessage(cleanupError)
        );
      }
    }
    throw err;
  }

  if (!updatedItem) {
    if (uploadedImage?.public_id) {
      try {
        await deleteFromCloudinary(uploadedImage.public_id);
      } catch (cleanupError: unknown) {
        console.warn(
          '[Cloudinary] تعذر حذف الصورة الجديدة بعد تعارض التعديل:',
          getErrorMessage(cleanupError)
        );
      }
    }

    throw new AppError(
      'تغيّرت حالة الغرض أثناء التعديل؛ حدّث الصفحة وحاول مجدداً',
      409,
      'ITEM_UPDATE_CONFLICT'
    );
  }

  if (
    uploadedImage?.public_id &&
    snapshot.cloudinaryId &&
    snapshot.cloudinaryId !== uploadedImage.public_id
  ) {
    try {
      await deleteFromCloudinary(snapshot.cloudinaryId);
    } catch (cleanupError: unknown) {
      console.warn(
        '[Cloudinary] تعذر حذف الصورة القديمة بعد التعديل:',
        getErrorMessage(cleanupError)
      );
    }
  }

  const itemObject = updatedItem.toObject
    ? updatedItem.toObject()
    : { ...updatedItem };

  return {
    msg: 'تم تحديث الغرض بنجاح ✅',
    item: toDonorItem(itemObject, userId),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. حذف غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteItemLogic = async (itemId: EntityId, userId: EntityId) => {
  const snapshot = await Item.findById(itemId)
    .select('donor bookedBy waitlist status cloudinaryId title recipientConfirmed linkedRequestId')
    .lean();

  if (!snapshot)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  assertGenericLifecycleAllowed(snapshot, userId);

  const isOwner = snapshot.donor?.toString() === userId?.toString();
  if (!isOwner)
    throw new AppError('ليس لديك صلاحية حذف هذا الغرض', 403, 'FORBIDDEN');

  if (snapshot.status === 'تم التسليم')
    throw new AppError(
      'لا يمكن حذف غرض تم تسليمه',
      409,
      'DELIVERED_ITEM_DELETE_FORBIDDEN'
    );
  if (snapshot.recipientConfirmed)
    throw new AppError(
      'لا يمكن حذف الغرض بعد تأكيد الاستلام وقبل إكمال التسليم',
      409,
      'HANDOVER_CONFIRMATION_IN_PROGRESS'
    );

  const deleteFilter = {
    _id: itemId,
    donor: userId,
    linkedRequestId: null,
    status: { $ne: 'تم التسليم' },
    recipientConfirmed: { $ne: true },
  };

  const deletedItem = await Item.findOneAndDelete(deleteFilter);
  if (!deletedItem)
    throw new AppError(
      'تغيّرت حالة الغرض أثناء الحذف؛ حدّث الصفحة وحاول مجدداً',
      409,
      'ITEM_DELETE_CONFLICT'
    );

  if (snapshot.cloudinaryId) {
    try {
      await deleteFromCloudinary(snapshot.cloudinaryId);
    } catch (cleanupError: unknown) {
      console.warn(
        '[Cloudinary] تعذر حذف صورة الغرض المحذوف:',
        getErrorMessage(cleanupError)
      );
    }
  }

  // إغلاق شاشة الغرض فوراً لدى الحاجز وقائمة الانتظار إن كانوا متصلين.
  const affectedUserIds = [...new Set([
    snapshot.bookedBy?.toString(),
    ...(snapshot.waitlist ?? []).map((entry: WaitlistEntry) => entry.user.toString()),
  ].filter(Boolean))];

  for (const affectedUserId of affectedUserIds) {
    emitToUser(affectedUserId, SOCKET_EVENTS.ITEM_DELETED, {
      itemId: snapshot._id,
    });
    queueNotification(affectedUserId, {
      type:  'item_deleted',
      title: 'تم حذف الغرض',
      body:  `لم يعد "${snapshot.title}" متاحاً لأن المتبرع حذفه.`,
    });
  }

  return { msg: 'تم حذف الغرض بنجاح ✅' };
};
