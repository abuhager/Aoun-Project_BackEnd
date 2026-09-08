import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisClient } from '../middlewares/rateLimiter.js';
import { isDistributedRuntime } from '../utils/runtimeBus.js';
import type { AounSocketServer } from './socketTypes.js';

type DuplicateClient = ReturnType<NonNullable<ReturnType<typeof getRedisClient>>['duplicate']>;

let pubClient: DuplicateClient | null = null;
let subClient: DuplicateClient | null = null;

export const attachSocketRedisAdapter = async (
  io: AounSocketServer
): Promise<boolean> => {
  if (!isDistributedRuntime()) return false;
  if (pubClient && subClient) return true;
  const client = getRedisClient();
  if (!client) throw new Error('DISTRIBUTED_REDIS_UNAVAILABLE');

  pubClient = client.duplicate();
  subClient = client.duplicate();
  pubClient.on('error', (error) => console.error('[Socket Redis pub]', error.message));
  subClient.on('error', (error) => console.error('[Socket Redis sub]', error.message));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  return true;
};

export const closeSocketRedisAdapter = async (): Promise<void> => {
  const clients = [pubClient, subClient];
  pubClient = null;
  subClient = null;
  await Promise.allSettled(clients.map(async (client) => {
    if (client?.isOpen) await client.quit();
  }));
};

export default { attachSocketRedisAdapter, closeSocketRedisAdapter };
