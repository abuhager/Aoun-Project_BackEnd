import type { ClientSession } from 'mongoose';
import Item from '../models/Item.js';
import DonationRequest from '../models/DonationRequest.js';
import DonationOffer from '../models/DonationOffer.js';
import Conversation from '../models/Conversation.js';
import SystemSettings from '../models/SystemSettings.js';
import AppError from '../utils/AppError.js';
import runMongoTransaction from '../utils/mongoTransaction.js';
import { findNextEligibleWaitlistCandidate } from './itemService.js';
import type { EntityId, ServicePayload } from './serviceTypes.js';
import { SOCKET_EVENTS } from '../socket/contracts.js';

export type BanEffect = {
  userId: EntityId;
  event: typeof SOCKET_EVENTS.ITEM_BOOKING_CANCELLED | typeof SOCKET_EVENTS.ITEM_WAITLIST_PROMOTED | typeof SOCKET_EVENTS.ITEM_BOOKING_TRANSFERRED;
  notification: ServicePayload;
  itemId: EntityId;
  status: string;
};

const resetBooking = {
  bookedBy: null, bookedAt: null, recipientConfirmed: false, donorConfirmed: false,
  recipientConfirmedAt: null, donorConfirmedAt: null, deliveredAt: null, reminderSent: false,
};

// All database transitions share the moderation transaction. The caller publishes
// the returned effects only after commit, including during automatic report bans.
export async function applyBanConsequences(
  userId: EntityId,
  session: ClientSession | null = null
): Promise<BanEffect[]> {
  if (!session) return runMongoTransaction(tx => applyBanConsequences(userId, tx));
  const settings = await SystemSettings.getCached();
  const effects: BanEffect[] = [];
  const items = await Item.find({
    status: { $in: ['متاح', 'محجوز'] },
    $or: [{ donor: userId }, { bookedBy: userId }],
  }).session(session).lean();

  for (const item of items) {
    const donorBanned = String(item.donor) === String(userId);
    const previousBooker = item.bookedBy;
    let status = 'مخفي';
    let nextBooker: EntityId | null = null;

    if (!donorBanned && !item.linkedRequestId) {
      const next = await findNextEligibleWaitlistCandidate(
        item.waitlist, item._id, settings.maxBookingsPerUser ?? 3,
        [item.donor, userId, ...(item.cancelledBy ?? [])], session
      );
      nextBooker = next.candidate?._id ?? null;
      status = nextBooker ? 'محجوز' : 'متاح';
      const changed = await Item.updateOne({
        _id: item._id, status: item.status, bookedBy: previousBooker,
        bookedAt: item.bookedAt, linkedRequestId: null,
      }, {
        $set: {
          ...resetBooking, status, bookedBy: nextBooker,
          bookedAt: nextBooker ? new Date() : null,
        },
        $pull: { waitlist: { user: { $in: [userId, ...next.skippedUserIds, ...(nextBooker ? [nextBooker] : [])] } } },
        $addToSet: { cancelledBy: userId },
      }, { session });
      if (changed.matchedCount !== 1) throw new AppError('تغير الحجز أثناء الحظر', 409, 'MODERATION_BOOKING_CONFLICT');
      if (nextBooker) effects.push({
        userId: nextBooker, itemId: item._id, status, event: SOCKET_EVENTS.ITEM_WAITLIST_PROMOTED,
        notification: {
          type: 'waitlist_promoted', title: 'وصل دورك في الحجز',
          body: `انتقل إليك حجز "${item.title}" بعد تدخل الإدارة.`,
          itemId: item._id, actionUrl: `/items/${item._id}`,
        },
      });
    } else {
      // A request-linked exchange is cancelled as a unit; it must never enter
      // public booking or promote a general waitlist.
      if (item.linkedRequestId) {
        await DonationRequest.updateOne({
          _id: item.linkedRequestId, fulfilledByItem: item._id,
        }, { $set: { status: 'cancelled', fulfilledByItem: null } }, { session });
        await DonationOffer.updateMany({
          request: item.linkedRequestId, status: 'accepted',
        }, { $set: { status: 'cancelled_by_admin' } }, { session, runValidators: true });
      }
      await Item.updateOne({ _id: item._id, status: item.status }, {
        $set: { ...resetBooking, status, waitlist: [] },
      }, { session });
      for (const entry of item.waitlist ?? []) effects.push({
        userId: entry.user, itemId: item._id, status, event: SOCKET_EVENTS.ITEM_BOOKING_CANCELLED,
        notification: { type: 'booking_cancelled', title: 'أُغلق انتظار الغرض',
          body: `أوقفت الإدارة تبادل "${item.title}".`, itemId: item._id, actionUrl: '/dashboard' },
      });
    }

    await Conversation.updateMany({ item: item._id, kind: 'booking', archivedAt: null }, {
      $set: { archivedAt: new Date(), archiveReason: 'account_banned' },
    }, { session });
    for (const participant of [item.donor, previousBooker]) {
      if (!participant || String(participant) === String(userId)) continue;
      effects.push({ userId: participant, itemId: item._id, status,
        event: nextBooker ? SOCKET_EVENTS.ITEM_BOOKING_TRANSFERRED : SOCKET_EVENTS.ITEM_BOOKING_CANCELLED,
        notification: { type: 'booking_cancelled', title: 'تحديث التبادل من الإدارة',
          body: nextBooker ? `انتقل حجز "${item.title}" لأول منتظر مؤهل.` : `أُوقف الحجز السابق على "${item.title}".`,
          itemId: item._id, actionUrl: item.linkedRequestId ? `/donation-requests/${item.linkedRequestId}` : `/items/${item._id}` },
      });
    }
  }
  await Item.updateMany({ 'waitlist.user': userId }, {
    $pull: { waitlist: { user: userId } },
  }, { session });
  return effects;
}
