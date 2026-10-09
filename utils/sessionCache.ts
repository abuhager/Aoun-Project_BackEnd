import { parsePositiveInteger } from '../config/env.js';
import { publishRuntimeEvent, subscribeRuntimeEvent } from './runtimeBus.js';

type CacheEntry = { state: unknown; cachedAt: number };

/** Fixed TTL, bounded LRU storage. Reading an entry never renews its TTL. */
export class TtlSessionCache {
  private entries = new Map<string, CacheEntry>();
  constructor(
    readonly ttlMs: number,
    readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {}
  get(userId: unknown): unknown | undefined {
    const key = String(userId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (this.now() - entry.cachedAt >= this.ttlMs) return undefined;
    this.entries.set(key, entry);
    return entry.state;
  }
  set(userId: unknown, state: unknown): void {
    const key = String(userId);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { state, cachedAt: this.now() });
  }
  invalidate(userId: unknown): void { this.entries.delete(String(userId)); }
  prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.cachedAt <= cutoff) this.entries.delete(key);
    }
  }
  stats() {
    this.prune();
    return {
      size: this.entries.size, ttl_ms: this.ttlMs,
      max_entries: this.maxEntries, entries: [...this.entries.keys()],
    };
  }
}

const cache = new TtlSessionCache(
  parsePositiveInteger(process.env.SESSION_CACHE_TTL_MS, 60_000, { min: 1, max: 300_000 }),
  parsePositiveInteger(process.env.SESSION_CACHE_MAX_ENTRIES, 5_000, { min: 1, max: 100_000 })
);
const cleanup = setInterval(() => cache.prune(), Math.min(cache.ttlMs, 60_000));
cleanup.unref();

export const get = (userId: unknown) => cache.get(userId);
export const set = (userId: unknown, state: unknown) => cache.set(userId, state);
export const invalidateLocal = (userId: unknown) => cache.invalidate(userId);
export const stats = () => cache.stats();
export const invalidate = (userId: unknown): void => {
  invalidateLocal(userId);
  void publishRuntimeEvent('session:invalidate', { userId: String(userId) })
    .catch((error: unknown) => console.error(
      '[SessionCache] failed to publish invalidation:',
      error instanceof Error ? error.message : String(error)
    ));
};
subscribeRuntimeEvent('session:invalidate', ({ userId }) => {
  if (userId != null) invalidateLocal(userId);
});
export default { get, set, invalidate, invalidateLocal, stats };
