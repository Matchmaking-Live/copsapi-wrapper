export interface CacheStore {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly maxEntries = 5000, private readonly now: () => number = Date.now) {}

  get(key: string): unknown {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface CacheTtls {
  profile: number;
  servers: number;
  leaderboard: number;
  history: number;
  match: number;
  weapons: number;
}

export const DEFAULT_TTLS: CacheTtls = {
  profile: 5 * 60_000,
  servers: 30_000,
  leaderboard: 60_000,
  history: 60_000,
  match: 60 * 60_000,
  weapons: 2 * 60_000,
};
