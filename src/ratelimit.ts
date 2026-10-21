import { CopsApiError } from './errors.js';
import { sleep } from './sleep.js';

export type Priority = 'high' | 'normal';

export interface RateLimitOptions {
  limit?: number;
  reserve?: number;
  onExhausted?: 'wait' | 'throw';
  maxWaitMs?: number;
}

export interface QuotaSnapshot {
  limit: number;
  remaining: number;
  resetAt: Date;
  resetsInMs: number;
  reserve: number;
}

const nextMinute = (now: number) => (Math.floor(now / 60_000) + 1) * 60_000;

export class QuotaTracker {
  private limit: number;
  private remaining: number;
  private resetAt = 0;
  private inFlight = 0;
  private readonly reserve: number;
  private readonly mode: 'wait' | 'throw';
  private readonly maxWaitMs: number;

  constructor(opts: RateLimitOptions = {}, private readonly now: () => number = Date.now) {
    this.limit = opts.limit ?? 60;
    this.remaining = this.limit;
    this.reserve = Math.max(0, opts.reserve ?? 0);
    this.mode = opts.onExhausted ?? 'wait';
    this.maxWaitMs = opts.maxWaitMs ?? 65_000;
  }

  private roll(now: number) {
    if (now >= this.resetAt) {
      this.remaining = this.limit;
      this.resetAt = nextMinute(now);
    }
  }

  async acquire(priority: Priority, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.now();
      this.roll(now);
      const floor = priority === 'normal' ? this.reserve : 0;
      if (this.remaining > floor) {
        this.remaining -= 1;
        this.inFlight += 1;
        return;
      }
      const waitMs = this.resetAt - now + 25;
      if (this.mode === 'throw' || waitMs > this.maxWaitMs) {
        const why = floor > 0 ? `the last ${floor} requests of this minute are reserved for high-priority calls` : 'the per-minute quota is used up';
        throw new CopsApiError('rate_limited', `Request held back: ${why}.`, 429, Math.ceil(waitMs / 1000), { local: true });
      }
      await sleep(waitMs, signal);
    }
  }

  release() {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  update(headers: Headers) {
    const limit = Number(headers.get('x-ratelimit-limit'));
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (Number.isFinite(limit) && limit > 0) this.limit = limit;
    if (Number.isFinite(reset) && reset > 0) this.resetAt = reset * 1000;
    if (headers.has('x-ratelimit-remaining') && Number.isFinite(remaining)) {
      this.remaining = Math.max(0, remaining - Math.max(0, this.inFlight - 1));
    }
  }

  exhaust(retryAfterSec: number | null) {
    this.remaining = 0;
    if (retryAfterSec != null) this.resetAt = this.now() + retryAfterSec * 1000;
  }

  msUntilReset(): number {
    return Math.max(0, this.resetAt - this.now());
  }

  snapshot(): QuotaSnapshot {
    const now = this.now();
    this.roll(now);
    return { limit: this.limit, remaining: this.remaining, resetAt: new Date(this.resetAt), resetsInMs: Math.max(0, this.resetAt - now), reserve: this.reserve };
  }
}

export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}
