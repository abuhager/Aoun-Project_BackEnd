import crypto from 'node:crypto';
import os from 'node:os';
import { getRedisClient } from '../middlewares/rateLimiter.js';

type RuntimeEvent = {
  source: string;
  kind: string;
  data: Record<string, unknown>;
  emittedAt: string;
};
type RuntimeEventHandler = (data: Record<string, unknown>) => void | Promise<void>;

const CHANNEL = 'aoun:runtime:v1';
const NODE_ID = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const handlers = new Map<string, Set<RuntimeEventHandler>>();
let subscriber: ReturnType<NonNullable<ReturnType<typeof getRedisClient>>['duplicate']> | null = null;

export const isDistributedRuntime = (): boolean => (
  process.env.RUNTIME_TOPOLOGY?.trim().toLowerCase() === 'distributed'
);

export const subscribeRuntimeEvent = (
  kind: string,
  handler: RuntimeEventHandler
): (() => void) => {
  const current = handlers.get(kind) ?? new Set<RuntimeEventHandler>();
  current.add(handler);
  handlers.set(kind, current);
  return () => current.delete(handler);
};

export const publishRuntimeEvent = async (
  kind: string,
  data: Record<string, unknown>
): Promise<boolean> => {
  if (!isDistributedRuntime()) return false;
  const client = getRedisClient();
  if (!client) throw new Error('DISTRIBUTED_REDIS_UNAVAILABLE');
  const event: RuntimeEvent = {
    source: NODE_ID,
    kind,
    data,
    emittedAt: new Date().toISOString(),
  };
  await client.publish(CHANNEL, JSON.stringify(event));
  return true;
};

export const startRuntimeBus = async (): Promise<void> => {
  if (!isDistributedRuntime() || subscriber) return;
  const client = getRedisClient();
  if (!client) throw new Error('DISTRIBUTED_REDIS_UNAVAILABLE');
  subscriber = client.duplicate();
  subscriber.on('error', (error) => {
    console.error('[RuntimeBus] Redis subscriber error:', error.message);
  });
  await subscriber.connect();
  await subscriber.subscribe(CHANNEL, async (raw) => {
    let event: RuntimeEvent;
    try {
      event = JSON.parse(raw) as RuntimeEvent;
    } catch {
      return;
    }
    if (event.source === NODE_ID || typeof event.kind !== 'string') return;
    const listeners = [...(handlers.get(event.kind) ?? [])];
    await Promise.allSettled(listeners.map((listener) => listener(event.data ?? {})));
  });
};

export const stopRuntimeBus = async (): Promise<void> => {
  const active = subscriber;
  subscriber = null;
  if (!active?.isOpen) return;
  await active.unsubscribe(CHANNEL).catch(() => undefined);
  await active.quit();
};

export { CHANNEL as RUNTIME_BUS_CHANNEL, NODE_ID as RUNTIME_NODE_ID };

export default {
  isDistributedRuntime,
  publishRuntimeEvent,
  startRuntimeBus,
  stopRuntimeBus,
  subscribeRuntimeEvent,
};
