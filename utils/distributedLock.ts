import crypto from 'node:crypto';
import { getRedisClient } from '../middlewares/rateLimiter.js';
import { isDistributedRuntime } from './runtimeBus.js';

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;
const EXTEND_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

export const runWithDistributedLock = async <T>(
  name: string,
  ttlMs: number,
  work: () => Promise<T>
): Promise<{ acquired: boolean; result?: T }> => {
  if (!isDistributedRuntime()) return { acquired: true, result: await work() };
  const client = getRedisClient();
  if (!client) throw new Error('DISTRIBUTED_REDIS_UNAVAILABLE');

  const key = `aoun:lock:${name}`;
  const token = crypto.randomUUID();
  const acquired = await client.set(key, token, { NX: true, PX: ttlMs });
  if (acquired !== 'OK') return { acquired: false };

  const extension = setInterval(() => {
    void client.eval(EXTEND_SCRIPT, {
      keys: [key],
      arguments: [token, String(ttlMs)],
    }).catch((error: unknown) => console.error(
      `[DistributedLock] failed to extend ${name}:`,
      error instanceof Error ? error.message : String(error)
    ));
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  extension.unref?.();

  try {
    return { acquired: true, result: await work() };
  } finally {
    clearInterval(extension);
    await client.eval(RELEASE_SCRIPT, {
      keys: [key],
      arguments: [token],
    }).catch(() => undefined);
  }
};

export default { runWithDistributedLock };
