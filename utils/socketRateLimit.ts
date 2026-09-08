import { getRedisClient } from '../middlewares/rateLimiter.js';

const WINDOW_MS = 10_000;
const MAX_MESSAGES = 15;
const REDIS_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

const localWindows = new Map<string, number[]>();

export type SocketRateLimitResult = {
  allowed: boolean;
  unavailable: boolean;
};

const consumeLocal = (userId: string, now: number): SocketRateLimitResult => {
  const recent = (localWindows.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < WINDOW_MS
  );
  if (recent.length >= MAX_MESSAGES) {
    localWindows.set(userId, recent);
    return { allowed: false, unavailable: false };
  }
  recent.push(now);
  localWindows.set(userId, recent);

  if (localWindows.size > 10_000) {
    for (const [key, timestamps] of localWindows) {
      if (!timestamps.some((timestamp) => now - timestamp < WINDOW_MS)) {
        localWindows.delete(key);
      }
    }
  }
  return { allowed: true, unavailable: false };
};

export const consumeSocketMessageQuota = async (
  userId: string,
  now = Date.now()
): Promise<SocketRateLimitResult> => {
  const redis = getRedisClient();
  if (!redis) {
    if (process.env.RUNTIME_TOPOLOGY === 'distributed') {
      return { allowed: false, unavailable: true };
    }
    return consumeLocal(userId, now);
  }

  try {
    const windowId = Math.floor(now / WINDOW_MS);
    const count = Number(await redis.eval(REDIS_SCRIPT, {
      keys: [`socket-rate:message:${windowId}:${userId}`],
      arguments: [String(WINDOW_MS * 2)],
    }));
    return { allowed: count <= MAX_MESSAGES, unavailable: false };
  } catch {
    return process.env.RUNTIME_TOPOLOGY === 'distributed'
      ? { allowed: false, unavailable: true }
      : consumeLocal(userId, now);
  }
};

export const resetSocketRateLimitsForTests = () => localWindows.clear();

export { WINDOW_MS as SOCKET_MESSAGE_RATE_WINDOW_MS, MAX_MESSAGES as SOCKET_MESSAGE_RATE_MAX };
export default { consumeSocketMessageQuota, resetSocketRateLimitsForTests };
