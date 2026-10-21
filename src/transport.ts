import { CopsApiError, type ApiErrorCode } from './errors.js';
import { QuotaTracker, Semaphore, type Priority } from './ratelimit.js';
import { sleep } from './sleep.js';
import type { ApiErrorBody } from './types.js';

export type QueryValue = string | number | boolean | readonly (string | number)[] | undefined | null;
export type HttpMethod = 'GET' | 'POST';

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
  priority?: Priority;
  signal?: AbortSignal;
  authenticated?: boolean;
}

export interface RequestInfo {
  method: HttpMethod;
  path: string;
  attempt: number;
}

export interface ResponseInfo extends RequestInfo {
  status: number;
  durationMs: number;
}

export interface RetryInfo extends RequestInfo {
  reason: 'network' | 'timeout' | 'gateway' | 'rate_limited' | 'server_error';
  delayMs: number;
  error: CopsApiError;
}

export interface Hooks {
  onRequest?(info: RequestInfo): void;
  onResponse?(info: ResponseInfo): void;
  onRetry?(info: RetryInfo): void;
}

export interface TransportOptions {
  token: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  gatewayRetries: number;
  maxRateLimitWaitSec: number;
  authHeader: 'bearer' | 'x-api-key';
  userAgent: string | null;
  fetch: typeof fetch;
  quota: QuotaTracker;
  maxConcurrent: number;
  dedupe: boolean;
  hooks: Hooks;
}

const API_CODES = new Set<string>([
  'missing_token', 'invalid_token', 'token_revoked', 'insufficient_permissions', 'rate_limited', 'bad_request',
  'user_not_found', 'game_not_found', 'server_unavailable', 'api_disabled', 'internal_error',
]);

function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return 'invalid_token';
  if (status === 403) return 'insufficient_permissions';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'server_unavailable';
  if (status >= 500) return 'internal_error';
  return 'bad_request';
}

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export class Transport {
  readonly #token: string | undefined;
  private readonly gate: Semaphore;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly opts: TransportOptions) {
    this.#token = opts.token;
    this.gate = new Semaphore(Math.max(1, opts.maxConcurrent));
  }

  get hasToken(): boolean {
    return !!this.#token;
  }

  url(path: string, query: Record<string, QueryValue> = {}): string {
    const url = new URL(this.opts.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        if (value.length) url.searchParams.set(key, value.join(','));
      } else url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = this.url(path, opts.query);
    if (method !== 'GET' || !this.opts.dedupe || opts.signal) return this.gate.run(() => this.send<T>(url, path, method, opts));
    const key = `${opts.priority ?? 'normal'} ${url}`;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const job = this.gate.run(() => this.send<T>(url, path, method, opts)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private headers(hasBody: boolean, authenticated: boolean): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (this.opts.userAgent) headers['User-Agent'] = this.opts.userAgent;
    if (authenticated && this.#token) {
      if (this.opts.authHeader === 'x-api-key') headers['X-Api-Key'] = this.#token;
      else headers.Authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  private async send<T>(url: string, path: string, method: HttpMethod, opts: RequestOptions): Promise<T> {
    const authenticated = opts.authenticated !== false;
    if (authenticated && !this.#token) {
      throw new CopsApiError('missing_token', 'No API token configured. Pass `token` or set COPS_API_TOKEN.', 0, null, { method, path, local: true });
    }
    const idempotent = method === 'GET';
    const priority = opts.priority ?? 'normal';
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers = this.headers(body !== undefined, authenticated);
    const ctx = { method, path };
    let attempt = 0;
    let networkRetries = 0;
    let gatewayRetries = 0;
    let serverRetries = 0;
    let rateWaits = 0;

    const retry = async (reason: RetryInfo['reason'], delayMs: number, error: CopsApiError) => {
      this.opts.hooks.onRetry?.({ method, path, attempt, reason, delayMs, error });
      await sleep(delayMs, opts.signal);
    };

    for (;;) {
      attempt += 1;
      if (authenticated) await this.opts.quota.acquire(priority, opts.signal);
      this.opts.hooks.onRequest?.({ method, path, attempt });
      const started = Date.now();
      const timeout = AbortSignal.timeout(this.opts.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

      let res: Response;
      try {
        res = await this.opts.fetch(url, { method, headers, body, signal });
      } catch (cause) {
        if (authenticated) this.opts.quota.release();
        if (opts.signal?.aborted) throw new CopsApiError('aborted', 'Request aborted.', 0, null, { ...ctx, cause });
        const timedOut = timeout.aborted;
        const error = new CopsApiError(
          timedOut ? 'timeout' : 'network',
          timedOut ? `No answer from the Critical Ops API within ${this.opts.timeoutMs} ms.` : `Critical Ops API unreachable: ${(cause as Error)?.message ?? cause}`,
          0, null, { ...ctx, cause },
        );
        if (idempotent && networkRetries < this.opts.retries) {
          networkRetries += 1;
          await retry(timedOut ? 'timeout' : 'network', 250 * 2 ** (networkRetries - 1), error);
          continue;
        }
        throw error;
      }

      if (authenticated) {
        this.opts.quota.update(res.headers);
        this.opts.quota.release();
      }
      this.opts.hooks.onResponse?.({ method, path, attempt, status: res.status, durationMs: Date.now() - started });
      const text = await res.text().catch(() => '');
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }

      if (res.ok) {
        if (json === undefined) throw new CopsApiError('invalid_response', `Expected JSON from ${path}, got ${text.slice(0, 60) || 'an empty body'}.`, res.status, null, ctx);
        return json as T;
      }

      const apiError = (json as ApiErrorBody | undefined)?.error;
      if (!apiError && (res.status === 404 || res.status >= 500)) {
        const error = new CopsApiError('gateway', `Critical Ops API gateway answered ${res.status} ${text.slice(0, 40).trim()}`.trim(), res.status, null, ctx);
        if (gatewayRetries < this.opts.gatewayRetries) {
          gatewayRetries += 1;
          await retry('gateway', 150 * gatewayRetries, error);
          continue;
        }
        throw error;
      }

      const code = apiError && API_CODES.has(apiError.code) ? (apiError.code as ApiErrorCode) : fallbackCode(res.status);
      const retryAfter = positive(res.headers.get('retry-after')) ?? positive(apiError?.retry_after);
      const error = new CopsApiError(code, apiError?.message || `Critical Ops API error ${res.status}`, res.status, retryAfter, ctx);

      if (code === 'rate_limited') {
        this.opts.quota.exhaust(retryAfter);
        const waitSec = retryAfter ?? Math.ceil(this.opts.quota.msUntilReset() / 1000);
        if (rateWaits < 2 && waitSec <= this.opts.maxRateLimitWaitSec) {
          rateWaits += 1;
          await retry('rate_limited', waitSec * 1000, error);
          continue;
        }
        throw error;
      }

      if (idempotent && (code === 'internal_error' || code === 'server_unavailable') && serverRetries < this.opts.retries) {
        serverRetries += 1;
        await retry('server_error', 500 * 2 ** (serverRetries - 1), error);
        continue;
      }
      throw error;
    }
  }
}
