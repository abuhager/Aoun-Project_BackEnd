import mongoose from 'mongoose';
import BackgroundJobState from '../models/BackgroundJobState.js';
import Item from '../models/Item.js';
import SystemSettings from '../models/SystemSettings.js';
import { assessJobHealth } from './jobHealth.js';
import { getCronStatus } from '../jobs/cronJobs.js';
import { getRateLimiterStatus } from '../middlewares/rateLimiter.js';
import { isEnabled, parsePositiveInteger } from '../config/env.js';
import outboxRepository from '../repositories/outboxRepository.js';

const DATABASE_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

// Cache only non-authorizing observations, never account or business state.
let jobObservation: {
  sampledAt: number;
  states: Array<{
    _id: string; lastStatus: string; lastRun?: Date | null; lastFinishedAt?: Date | null;
    lastSuccessAt?: Date | null; nextRunAt?: Date | null; consecutiveFailures?: number;
  }>;
  oldestExpiredAgeMs: number;
} | null = null;
const loadJobObservation = async () => {
  if (jobObservation && Date.now() - jobObservation.sampledAt < 30_000) return jobObservation;
  const settings = await SystemSettings.getCached();
  const deadline = new Date(Date.now() - (settings.bookingExpiryHours ?? 72) * 60 * 60_000);
  const [states, oldest] = await Promise.all([
    BackgroundJobState.find({}).lean().maxTimeMS(1_000),
    Item.findOne({
      status: 'محجوز', linkedRequestId: null, bookedBy: { $type: 'objectId' },
      bookedAt: { $type: 'date', $lte: deadline },
      $or: [{ recipientConfirmed: { $ne: true } }, { donorConfirmed: { $ne: true } }],
    }).select('bookedAt').sort({ bookedAt: 1 }).lean().maxTimeMS(1_000),
  ]);
  jobObservation = {
    sampledAt: Date.now(), states,
    oldestExpiredAgeMs: oldest?.bookedAt ? Math.max(0, deadline.getTime() - oldest.bookedAt.getTime()) : 0,
  };
  return jobObservation;
};

const getRuntimeReadiness = async () => {
  const dbState = mongoose.connection.readyState;
  const databaseReady = dbState === 1;

  const redis = getRateLimiterStatus();
  const redisRequired = isEnabled(process.env.REDIS_REQUIRED);
  const redisReady = !redisRequired || redis.redisReady;

  const cronStatus = getCronStatus();
  const jobsRequired = process.env.BACKGROUND_JOBS_REQUIRED !== 'false';
  let sharedJobs: Awaited<ReturnType<typeof loadJobObservation>> | null = null;
  let observationAvailable = !databaseReady;
  if (databaseReady) {
    try {
      sharedJobs = await loadJobObservation();
      observationAvailable = true;
    } catch {
      observationAvailable = false;
    }
  }
  const jobs = Object.fromEntries(Object.entries(cronStatus).map(([name, local]) => {
    // Use the shared leader's latest result on every node, retaining this node's
    // scheduler presence. A follower skipping the distributed lock is healthy.
    const persisted = sharedJobs?.states.find(state => state._id === name);
    const state = { ...local, ...persisted, scheduled: local.scheduled };
    return [name, {
      status: state.lastStatus, scheduled: state.scheduled,
      lastRun: state.lastRun, lastFinishedAt: state.lastFinishedAt ?? null,
      lastSuccessAt: state.lastSuccessAt ?? null, nextRunAt: state.nextRunAt ?? null,
      consecutiveFailures: state.consecutiveFailures ?? 0,
      ...assessJobHealth(name, state),
    }];
  }));
  const schedulerReady = Object.values(cronStatus).length > 0
    && Object.values(cronStatus).every(job => job.scheduled);
  const oldestExpiredAgeMs = sharedJobs?.oldestExpiredAgeMs ?? 0;
  const backlogHealthy = oldestExpiredAgeMs <= 2 * 60 * 60_000;
  const jobsHealthy = observationAvailable && backlogHealthy
    && Object.values(jobs).every(job => job.healthy);
  const jobsReady = !jobsRequired || (schedulerReady && jobsHealthy);

  const outboxRequired = isEnabled(process.env.OUTBOX_WORKER_REQUIRED);
  const maxHeartbeatAgeMs = parsePositiveInteger(
    process.env.OUTBOX_HEARTBEAT_MAX_AGE_MS,
    90_000,
    { min: 10_000, max: 15 * 60_000 }
  );
  let heartbeat: Awaited<ReturnType<typeof outboxRepository.getHeartbeat>> = null;
  if (databaseReady) {
    try {
      heartbeat = await outboxRepository.getHeartbeat();
    } catch {
      heartbeat = null;
    }
  }
  const heartbeatAgeMs = heartbeat?.heartbeatAt
    ? Date.now() - new Date(heartbeat.heartbeatAt).getTime()
    : null;
  const outboxReady = !outboxRequired || Boolean(
    heartbeat
    && heartbeat.state === 'running'
    && heartbeatAgeMs !== null
    && heartbeatAgeMs >= 0
    && heartbeatAgeMs <= maxHeartbeatAgeMs
  );

  // HTTP readiness is separate from business-job health to avoid restart loops.
  const ready = databaseReady && redisReady && (!jobsRequired || schedulerReady) && outboxReady;
  return {
    ready,
    status: ready && jobsReady ? 'ok' : 'degraded',
    businessReady: ready && jobsReady,
    database: {
      ready: databaseReady,
      state: DATABASE_STATES[dbState] ?? 'unknown',
    },
    redis: {
      required: redisRequired,
      ready: redis.redisReady,
      configured: redis.redisConfigured,
      store: redis.store,
    },
    backgroundJobs: {
      required: jobsRequired,
      ready: jobsReady,
      scheduled: schedulerReady,
      healthy: jobsHealthy,
      observationAvailable,
      oldestExpiredAgeMs,
      backlogHealthy,
      jobs,
    },
    outboxWorker: {
      required: outboxRequired,
      ready: outboxReady,
      state: heartbeat?.state ?? 'missing',
      heartbeatAt: heartbeat?.heartbeatAt ?? null,
      heartbeatAgeMs,
      maxHeartbeatAgeMs,
      lastProcessedAt: heartbeat?.lastProcessedAt ?? null,
      lastErrorCode: heartbeat?.lastErrorCode ?? null,
    },
  };
};

export { getRuntimeReadiness };
export default getRuntimeReadiness;
