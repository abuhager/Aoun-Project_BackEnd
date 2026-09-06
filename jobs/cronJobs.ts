import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import User from '../models/User.js';
import Item from '../models/Item.js';
import SystemSettings from '../models/SystemSettings.js';
import { settingsEvents } from '../models/SystemSettings.js';
import { fireSendEmail } from '../utils/sendEmail.js';
import { escapeHtml } from '../services/emailService.js';
import notifyUser from '../utils/notifyUser.js';
import { SOCKET_EVENTS } from '../socket/contracts.js';
import { emitToUser } from '../socket/emitter.js';
import { expireDonationRequestsLogic } from '../services/donationRequestService.js';
import type { Types } from 'mongoose';

// ══════════════════════════════════════════════════════════════
// ✅ NJ-19: سجل حالة Cron Jobs — يُساعد في Debugging
// ══════════════════════════════════════════════════════════════
const JOB_TIMEZONE = 'Asia/Amman';
const MAX_BOOKING_JOB_BATCH = 100;
type JobName =
  | 'quota-reset'
  | 'expire-old-bookings'
  | 'booking-reminder'
  | 'expire-donation-requests';
type CronStatusEntry = {
  lastRun: Date | null;
  lastFinishedAt?: Date | null;
  lastStatus: string;
  lastDurationMs?: number;
  lastError?: string | null;
};
type CronStatusSnapshot = Record<string, CronStatusEntry & { scheduled: boolean }>;
type IdLike = string | Types.ObjectId;
type WaitlistEntry = { user?: IdLike | null };
type BookingItem = {
  _id: IdLike;
  donor: IdLike;
  bookedBy?: IdLike | null;
  title: string;
  linkedRequestId?: unknown;
  bookedAt?: Date;
  cancelledBy?: IdLike[];
  waitlist?: WaitlistEntry[];
};
type BookingSettings = {
  maxBookingsPerUser?: number;
  bookingExpiryHours?: number;
  defaultUserQuota?: number;
  level2Quota?: number;
  quotaResetDayOfMonth?: number;
};
type WaitlistCandidate = { _id: IdLike; name: string; email: string };
type SettingsInvalidatedHandler = (
  event?: { changedFields?: string[] }
) => Promise<void>;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const scheduledTasks = new Map<JobName, ScheduledTask>();
let initialized = false;
let initializationPromise: Promise<CronStatusSnapshot> | null = null;
let settingsInvalidatedHandler: SettingsInvalidatedHandler | null = null;

const cronStatus: Record<JobName, CronStatusEntry> = {
  'quota-reset':              { lastRun: null, lastStatus: 'pending' },
  'expire-old-bookings':      { lastRun: null, lastStatus: 'pending' },
  'booking-reminder':         { lastRun: null, lastStatus: 'pending' },
  'expire-donation-requests': { lastRun: null, lastStatus: 'pending' },
};

const runSafe = async (
  name: JobName,
  fn: () => void | Promise<void>
): Promise<void> => {
  const start = Date.now();
  cronStatus[name] = {
    ...cronStatus[name],
    lastRun: new Date(),
    lastStatus: 'running',
    lastError: null,
  };
  console.log(`[Cron] ⏳ [${name}] بدأت`);
  try {
    await fn();
    const duration = Date.now() - start;
    cronStatus[name] = {
      ...cronStatus[name],
      lastFinishedAt: new Date(),
      lastStatus: 'success',
      lastDurationMs: duration,
      lastError: null,
    };
    console.log(`[Cron] ✅ [${name}] اكتملت في ${duration}ms`);
  } catch (err: unknown) {
    cronStatus[name] = {
      ...cronStatus[name],
      lastFinishedAt: new Date(),
      lastStatus: 'failed',
      lastDurationMs: Date.now() - start,
      lastError: getErrorMessage(err),
    };
    console.error(`[Cron] ❌ [${name}] فشلت:`, getErrorMessage(err));
  }
};

const getCronStatus = (): CronStatusSnapshot => Object.fromEntries(
  (Object.entries(cronStatus) as Array<[JobName, CronStatusEntry]>).map(([name, status]) => [
    name,
    { ...status, scheduled: scheduledTasks.has(name) },
  ])
);

const replaceScheduledTask = (
  name: JobName,
  expression: string,
  handler: () => void | Promise<void>
): ScheduledTask => {
  const existing = scheduledTasks.get(name);
  if (existing) existing.destroy();

  const task = cron.schedule(expression, handler, {
    name,
    noOverlap: true,
    timezone: JOB_TIMEZONE,
  });
  scheduledTasks.set(name, task);
  return task;
};

// ══════════════════════════════════════════════════════════════
// DC-08: Cron تصفير الكوتا — ديناميكية الجدولة
// ══════════════════════════════════════════════════════════════
function scheduleQuotaReset(dayOfMonth: number): void {
  const cronExpr = `0 0 ${dayOfMonth} * *`;
  console.log(`[Cron] 📅 جدولة تصفير الكوتا: "${cronExpr}"`);

  replaceScheduledTask('quota-reset', cronExpr, () =>
    runSafe('quota-reset', async () => {
      const settings = await SystemSettings.getCached();
      const [r1, r2] = await Promise.all([
        User.updateMany(
          { trustLevel: { $lte: 1 }, isBanned: false },
          { $set: { quota: settings.defaultUserQuota } }
        ),
        User.updateMany(
          { trustLevel: { $gte: 2 }, isBanned: false },
          { $set: { quota: settings.level2Quota } }
        ),
      ]);
      console.log(
        `[Cron] 📊 تجديد الكوتا: L0-L1=${r1.modifiedCount}, L2+=${r2.modifiedCount}`
      );
    })
  );
}

// ══════════════════════════════════════════════════════════════
// ✅ NJ-20 FIX: processExpiredItem ترسل إشعار للمستخدم المحظوظ
// ══════════════════════════════════════════════════════════════
async function findEligibleWaitlistCandidate(
  item: BookingItem,
  maxBookings: number
): Promise<{ candidate: WaitlistCandidate | null; skippedUserIds: IdLike[] }> {
  const skippedUserIds: IdLike[] = [];
  const excludedUserIds = new Set(
    [item.donor, item.bookedBy, ...(item.cancelledBy ?? [])]
      .filter((id): id is IdLike => id != null)
      .map((id) => id.toString())
  );

  for (const entry of item.waitlist ?? []) {
    if (!entry.user || excludedUserIds.has(entry.user.toString())) {
      if (entry.user) skippedUserIds.push(entry.user);
      continue;
    }
    const candidate = await User.findOne({
      _id: entry.user,
      role: { $nin: ['admin', 'super_admin'] },
      isVerified: true,
      isBanned: { $ne: true },
      isFrozen: { $ne: true },
      trustLevel: { $gte: 2 },
    }).select('_id name email').lean();

    if (!candidate) {
      skippedUserIds.push(entry.user);
      continue;
    }

    const activeBookings = await Item.countDocuments({
      _id: { $ne: item._id },
      bookedBy: candidate._id,
      status: 'محجوز',
    });

    if (activeBookings < maxBookings) {
      return { candidate, skippedUserIds };
    }

    skippedUserIds.push(entry.user);
  }

  return { candidate: null, skippedUserIds };
}

async function processExpiredItem(
  item: BookingItem,
  settings: BookingSettings
): Promise<void> {
  // عناصر تلبية الطلبات لها دورة حياة خاصة ولا تدخل انتهاء الحجز أو قائمة الانتظار العامة.
  if (item.linkedRequestId) return;

  const previousBookerId = item.bookedBy;
  const { candidate, skippedUserIds } = await findEligibleWaitlistCandidate(
    item,
    settings.maxBookingsPerUser ?? 3
  );

  const resetConfirmation = {
    recipientConfirmed:   false,
    recipientConfirmedAt: null,
    donorConfirmed:       false,
    donorConfirmedAt:     null,
    deliveredAt:          null,
    reminderSent:         false,
  };

  if (candidate) {
    const promoted = await Item.findOneAndUpdate(
      {
        _id: item._id,
        status: 'محجوز',
        bookedBy: previousBookerId,
        linkedRequestId: null,
        recipientConfirmed: { $ne: true },
      },
      {
        $set: {
          bookedBy: candidate._id,
          status:   'محجوز',
          bookedAt: new Date(),
          ...resetConfirmation,
        },
        $pull: {
          waitlist: {
            user: { $in: [...skippedUserIds, candidate._id] },
          },
        },
        $addToSet: { cancelledBy: previousBookerId },
      },
      { returnDocument: 'after' }
    );

    if (!promoted) return;

    emitToUser(candidate._id, SOCKET_EVENTS.ITEM_WAITLIST_PROMOTED, {
      itemId: item._id.toString(),
      status: 'محجوز',
    });
    emitToUser(item.donor, SOCKET_EVENTS.ITEM_BOOKING_TRANSFERRED, {
      itemId: item._id.toString(),
      bookedBy: candidate._id.toString(),
    });

    await notifyUser(candidate._id, {
      type:      'waitlist_promoted',
      title:     '🎉 وصل دورك!',
      body:      `انتهى وقت المستلم السابق — الدور وصل لك الآن في "${item.title}".`,
      itemId:    item._id,
      email:     candidate.email,
      actionUrl: `/items/${item._id}`,
    }).catch((err: unknown) =>
      console.warn('[Cron] notifyUser فشل:', getErrorMessage(err))
    );

    const safeCandidateName = escapeHtml(candidate.name);
    const safeItemTitle = escapeHtml(item.title);
    fireSendEmail({
      email:   candidate.email,
      subject: `وصل دورك في: ${item.title} 🎉`,
      message: `
        <div dir="rtl" style="font-family:sans-serif;line-height:1.8;max-width:540px;margin:auto;">
          <h2>مرحباً ${safeCandidateName}!</h2>
          <p>انتهى وقت المستلم السابق — الدور وصل لك الآن في <strong>${safeItemTitle}</strong>.</p>
          <p>⏱️ لديك مهلة محددة لإتمام الاستلام.</p>
          <p>يرجى التواصل مع المتبرع لتنسيق الاستلام.</p>
        </div>
      `,
    }).catch((err: unknown) => console.warn(
      '[Cron] فشل إرسال بريد الترقية:',
      getErrorMessage(err)
    ));

    await notifyUser(item.donor, {
      type:      'booking_transferred',
      title:     'تم نقل الحجز تلقائياً 🔄',
      body:      `انتهت مهلة المستلم السابق وانتقل حجز "${item.title}" للمنتظر التالي.`,
      itemId:    item._id,
      actionUrl: `/items/${item._id}`,
    }).catch((err: unknown) => console.warn(
      '[Cron] فشل إشعار المتبرع:',
      getErrorMessage(err)
    ));

  } else {
    const releaseUpdate: {
      $set: Record<string, unknown>;
      $addToSet: Record<string, unknown>;
      $pull?: Record<string, unknown>;
    } = {
      $set: {
        status:   'متاح',
        bookedBy: null,
        bookedAt: null,
        ...resetConfirmation,
      },
      $addToSet: { cancelledBy: previousBookerId },
    };
    if (skippedUserIds.length > 0) {
      releaseUpdate.$pull = { waitlist: { user: { $in: skippedUserIds } } };
    }

    const released = await Item.findOneAndUpdate(
      {
        _id: item._id,
        status: 'محجوز',
        bookedBy: previousBookerId,
        linkedRequestId: null,
        recipientConfirmed: { $ne: true },
      },
      releaseUpdate,
      { returnDocument: 'after' }
    );

    if (!released) return;

    emitToUser(item.donor, SOCKET_EVENTS.ITEM_BOOKING_CANCELLED, {
      itemId: item._id.toString(),
      status: 'متاح',
    });

    await notifyUser(item.donor, {
      type:      'booking_cancelled',
      title:     'انتهت مهلة الحجز',
      body:      `عاد "${item.title}" متاحاً بعد انتهاء مهلة المستلم.`,
      itemId:    item._id,
      actionUrl: `/items/${item._id}`,
    }).catch((err: unknown) => console.warn(
      '[Cron] فشل إشعار المتبرع:',
      getErrorMessage(err)
    ));
  }

  await notifyUser(previousBookerId, {
    type:      'booking_cancelled',
    title:     'انتهت مهلة حجزك',
    body:      `انتهت مهلة استلام "${item.title}" وتم إلغاء الحجز.`,
    itemId:    item._id,
    actionUrl: `/items/${item._id}`,
  }).catch((err: unknown) => console.warn(
    '[Cron] فشل إشعار المستلم السابق:',
    getErrorMessage(err)
  ));

  emitToUser(previousBookerId, SOCKET_EVENTS.ITEM_BOOKING_CANCELLED, {
    itemId: item._id.toString(),
  });
}

// ══════════════════════════════════════════════════════════════
// تهيئة كل الـ Cron Jobs
// ══════════════════════════════════════════════════════════════
const stopCronJobs = async (): Promise<void> => {
  initialized = false;

  if (settingsInvalidatedHandler) {
    settingsEvents.off('invalidated', settingsInvalidatedHandler);
    settingsInvalidatedHandler = null;
  }

  const tasks = [...scheduledTasks.values()];
  scheduledTasks.clear();
  await Promise.allSettled(
    tasks.map((task) => Promise.resolve(task.destroy()))
  );
};

const initCronJobs = (): Promise<CronStatusSnapshot> => {
  if (initialized) return Promise.resolve(getCronStatus());
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      const initSettings = await SystemSettings.getCached();
      scheduleQuotaReset(initSettings.quotaResetDayOfMonth);

      settingsInvalidatedHandler = async ({ changedFields = [] } = {}) => {
        if (
          !initialized
          || (
            changedFields.length > 0
            && !changedFields.includes('quotaResetDayOfMonth')
          )
        ) {
          return;
        }

        try {
          const fresh = await SystemSettings.getCached();
          if (initialized) scheduleQuotaReset(fresh.quotaResetDayOfMonth);
        } catch (error: unknown) {
          console.error('[Cron] ❌ فشل تحديث جدول الكوتا:', getErrorMessage(error));
        }
      };
      settingsEvents.on('invalidated', settingsInvalidatedHandler);

      replaceScheduledTask('expire-old-bookings', '0 * * * *', () =>
        runSafe('expire-old-bookings', async () => {
          const settings = await SystemSettings.getCached();
          const expiryHours = Number(settings.bookingExpiryHours) || 24;
          const threshold = new Date(
            Date.now() - (expiryHours * 60 * 60 * 1000)
          );

          const expiredItems = await Item.find({
            status: 'محجوز',
            bookedBy: { $type: 'objectId' },
            linkedRequestId: null,
            bookedAt: { $exists: true, $type: 'date', $lt: threshold },
            recipientConfirmed: { $ne: true },
          })
            .sort({ bookedAt: 1 })
            .limit(MAX_BOOKING_JOB_BATCH)
            .select('_id bookedBy waitlist cancelledBy donor title linkedRequestId')
            .lean() as unknown as BookingItem[];

          if (!expiredItems.length) return;

          console.log(`[Cron] 🔍 حجوزات منتهية: ${expiredItems.length}`);
          const results = await Promise.allSettled(
            expiredItems.map((item) => processExpiredItem(item, settings))
          );
          const failed = results.filter(
            (result) => result.status === 'rejected'
          ).length;

          console.log(
            `[Cron] اكتمل: نجح ${expiredItems.length - failed}/${expiredItems.length}`
          );
          results
            .filter((result) => result.status === 'rejected')
            .forEach((result) =>
              console.error('  > فشل:', result.reason?.message)
            );
          if (failed > 0) {
            throw new AggregateError(
              results
                .filter((result) => result.status === 'rejected')
                .map((result) => result.reason),
              `فشلت معالجة ${failed} حجوزات منتهية`
            );
          }
        })
      );

      // تعمل كل 15 دقيقة وتغطي نافذة 15 دقيقة كاملة بلا فجوات.
      replaceScheduledTask('booking-reminder', '*/15 * * * *', () =>
        runSafe('booking-reminder', async () => {
          const settings = await SystemSettings.getCached();
          const expiryHours = Number(settings.bookingExpiryHours) || 24;
          const expiryMs = expiryHours * 60 * 60 * 1000;
          const now = Date.now();
          // أول محاولة قبل 60–75 دقيقة، وتبقى الحجوزات غير المذكّرة
          // مؤهلة للمحاولة مجدداً حتى لحظة الانتهاء.
          const windowFrom = new Date(now - expiryMs);
          const windowTo = new Date(now - expiryMs + (75 * 60 * 1000));

          if (
            Number.isNaN(windowFrom.getTime())
            || Number.isNaN(windowTo.getTime())
          ) {
            throw new Error('حسابات نطاق تذكير الحجز غير صالحة');
          }

          const soonExpiring = await Item.find({
            status: 'محجوز',
            bookedBy: { $type: 'objectId' },
            linkedRequestId: null,
            bookedAt: {
              $exists: true,
              $type: 'date',
              $gte: windowFrom,
              $lt: windowTo,
            },
            recipientConfirmed: { $ne: true },
            reminderSent: { $ne: true },
          })
            .sort({ bookedAt: 1 })
            .limit(MAX_BOOKING_JOB_BATCH)
            .populate('bookedBy', 'name email')
            .lean() as unknown as Array<BookingItem & {
              bookedBy: WaitlistCandidate;
              bookedAt: Date;
            }>;

          if (!soonExpiring.length) return;

          console.log(
            `[Cron] ⏰ حجوزات قاربت الانتهاء: ${soonExpiring.length}`
          );

          const reminderResults = await Promise.allSettled(
            soonExpiring.map(async (item) => {
              if (!item.bookedBy?._id) return;

              const bookingFilter = {
                _id: item._id,
                status: 'محجوز' as const,
                bookedBy: item.bookedBy._id,
                bookedAt: item.bookedAt,
                linkedRequestId: null,
                reminderSent: { $ne: true as const },
              };
              const claim = await Item.updateOne(
                bookingFilter,
                { $set: { reminderSent: true } }
              );
              if (claim.modifiedCount !== 1) return;

              try {
                await notifyUser(item.bookedBy, {
                  type: 'booking_expiry_reminder',
                  title: '⏰ تذكير: حجزك على وشك الانتهاء',
                  body: `لديك ساعة تقريباً لإتمام استلام "${item.title}" — تواصل مع المتبرع الآن.`,
                  itemId: item._id,
                  actionUrl: `/items/${item._id}`,
                });
              } catch (error: unknown) {
                await Item.updateOne(
                  { ...bookingFilter, reminderSent: true as const },
                  { $set: { reminderSent: false } }
                );
                console.warn('[Cron] فشل إشعار التذكير:', getErrorMessage(error));
                throw error;
              }
            })
          );
          const failedReminders = reminderResults.filter(
            (result) => result.status === 'rejected'
          );
          if (failedReminders.length > 0) {
            throw new AggregateError(
              failedReminders.map((result) => result.reason),
              `فشل إرسال ${failedReminders.length} تذكيرات حجز`
            );
          }
        })
      );

      replaceScheduledTask(
        'expire-donation-requests',
        '15 * * * *',
        () => runSafe('expire-donation-requests', async () => {
          const { expiredCount } = await expireDonationRequestsLogic(
            new Date(),
            { limit: 500 }
          );
          if (expiredCount > 0) {
            console.log(
              `[Cron] 🧹 ${expiredCount} طلب تبرع انتهت صلاحيته`
            );
          }
        })
      );

      initialized = true;
      return getCronStatus();
    } catch (error) {
      await stopCronJobs();
      throw error;
    }
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
};

export { getCronStatus, initCronJobs, runSafe, stopCronJobs };
export default {
  getCronStatus,
  initCronJobs,
  runSafe,
  stopCronJobs,
};
