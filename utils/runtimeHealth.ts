import mongoose from 'mongoose';
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

const getRuntimeReadiness = async () => {
  const dbState = mongoose.connection.readyState;
  const databaseReady = dbState === 1;

  const redis = getRateLimiterStatus();
  const redisRequired = isEnabled(process.env.REDIS_REQUIRED);
  const redisReady = !redisRequired || redis.redisReady;

  const cronStatus = getCronStatus();
  const jobsRequired = process.env.BACKGROUND_JOBS_REQUIRED !== 'false';
  const jobs = Object.fromEntries(
    Object.entries(cronStatus).map(([name, job]) => [
      name,
      {
        status: job.lastStatus,
        scheduled: job.scheduled,
        lastRun: job.lastRun,
        lastFinishedAt: job.lastFinishedAt ?? null,
      },
    ])
  );
  const jobEntries = Object.values(cronStatus);
  const jobsReady = !jobsRequired || (
    jobEntries.length > 0
    && jobEntries.every((job) => job.scheduled)
  );

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

  const ready = databaseReady && redisReady && jobsReady && outboxReady;
  return {
    ready,
    status: ready ? 'ok' : 'degraded',
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
