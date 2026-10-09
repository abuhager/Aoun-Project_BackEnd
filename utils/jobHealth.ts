export type JobHealthState = {
  scheduled: boolean;
  lastStatus: string;
  lastRun?: Date | string | null;
  lastSuccessAt?: Date | string | null;
  nextRunAt?: Date | string | null;
  consecutiveFailures?: number;
};

const HOURLY_MAX_AGE_MS = 2 * 60 * 60_000;
const MONTHLY_MAX_AGE_MS = 35 * 24 * 60 * 60_000;
const RUN_MAX_DURATION_MS = 30 * 60_000;
const GRACE_MS = 20 * 60_000;

export function assessJobHealth(name: string, job: JobHealthState, now = Date.now()) {
  const maxSuccessAgeMs = name === 'quota-reset' ? MONTHLY_MAX_AGE_MS : HOURLY_MAX_AGE_MS;
  const successAt = job.lastSuccessAt ? new Date(job.lastSuccessAt).getTime() : null;
  const successAgeMs = successAt === null ? null : Math.max(0, now - successAt);
  const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt).getTime() : null;
  const runAt = job.lastRun ? new Date(job.lastRun).getTime() : null;
  let reason: string | null = null;
  if (!job.scheduled) reason = 'NOT_SCHEDULED';
  else if ((job.consecutiveFailures ?? 0) >= 2) reason = 'REPEATED_FAILURES';
  else if (job.lastStatus === 'running' && runAt !== null && now - runAt > RUN_MAX_DURATION_MS) reason = 'RUN_OVERDUE';
  else if (successAgeMs !== null && successAgeMs > maxSuccessAgeMs) reason = 'SUCCESS_STALE';
  else if (nextRunAt !== null && now > nextRunAt + GRACE_MS) reason = 'SCHEDULE_MISSED';
  else if (job.lastStatus === 'failed') reason = 'LAST_RUN_FAILED';
  return { healthy: reason === null, reason, successAgeMs, maxSuccessAgeMs };
}
