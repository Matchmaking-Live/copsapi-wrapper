import { DEFAULT_TTLS, MemoryCache, type CacheStore, type CacheTtls } from './cache.js';
import { GAME_TYPES, gameMode, isHostable, mapId, mapName, type GameTypeName } from './catalog.js';
import { CopsApiError, isCopsError } from './errors.js';
import { QuotaTracker, type Priority, type QuotaSnapshot, type RateLimitOptions } from './ratelimit.js';
import { sleep } from './sleep.js';
import { Transport, type Hooks, type QueryValue } from './transport.js';
import type {
  AutohostCommand,
  AutohostGame,
  GameTypeCode,
  LeaderboardEntry,
  LeaderboardType,
  MatchHistoryEntry,
  MatchInfo,
  Profile,
  ServerStatus,
  WeaponStats,
} from './types.js';
import { randomPassword, regionOf, type Region } from './util.js';
import { AutohostWatcher, type WatcherOptions } from './watcher.js';

export const VERSION = '1.0.0';
export const DEFAULT_BASE_URL = 'https://latest.prod.copsapi.criticalforce.fi/api/public/v2';

export interface CopsClientOptions {
  token?: string;
  validateToken?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  gatewayRetries?: number;
  maxRateLimitWaitSec?: number;
  rateLimit?: RateLimitOptions;
  maxConcurrent?: number;
  dedupe?: boolean;
  cache?: false | { store?: CacheStore; ttl?: Partial<CacheTtls> };
  authHeader?: 'bearer' | 'x-api-key';
  userAgent?: string | null;
  fetch?: typeof fetch;
  hooks?: Hooks;
  maxPlayersPerRequest?: number;
  dangerouslyAllowBrowser?: boolean;
}

export interface CallOptions {
  fresh?: boolean;
  signal?: AbortSignal;
  priority?: Priority;
}

export interface GameServer {
  id: number;
  name: string;
  online: boolean;
  region: Region | null;
}

export interface LeaderboardPage {
  type: LeaderboardType;
  page: number;
  rank: number | null;
  size: number;
  pages: number;
  entries: LeaderboardEntry[];
}

export interface HostOptions {
  serverId: number;
  map: number | string;
  mode: number | string;
  roomName: string;
  password?: string;
  validate?: boolean;
  signal?: AbortSignal;
}

export interface HostAndWaitOptions extends Omit<HostOptions, 'password'> {
  password?: string | false;
  owners?: number[];
  timeoutMs?: number;
  intervalMs?: number;
}

export interface HostedRoom {
  id: number;
  code: string;
  password: string | null;
  serverId: number;
  game: AutohostGame;
}

export interface TokenCheck {
  valid: boolean;
  autohost: boolean;
  error: CopsApiError | null;
  quota: QuotaSnapshot;
}

export const TOKEN_PATTERN = /^cops_[0-9a-f]{48}$/i;

const AUTOHOST_DENIED = 'Your API token does not have the Autohost permission, which hosting games (autohost.create, poll and control) needs. Ask Critical Force to grant it to your token; every other endpoint works without it.';

export interface WaitForRoomOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

type PlayerRef = number | string;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const isId = (v: PlayerRef): v is number => typeof v === 'number';

const gameTypeCode = (t: GameTypeName | GameTypeCode): GameTypeCode => (typeof t === 'number' ? t : GAME_TYPES[t]);

export class CopsClient {
  readonly profiles: ProfilesApi;
  readonly servers: ServersApi;
  readonly matches: MatchesApi;
  readonly stats: StatsApi;
  readonly leaderboards: LeaderboardsApi;
  readonly autohost: AutohostApi;

  readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly quotaTracker: QuotaTracker;
  private readonly store: CacheStore | null;
  private readonly ttl: CacheTtls;
  readonly maxPlayersPerRequest: number;

  private autohostAllowed: boolean | null = null;

  constructor(tokenOrOptions?: string | CopsClientOptions, maybeOptions: Omit<CopsClientOptions, 'token'> = {}) {
    const options: CopsClientOptions = typeof tokenOrOptions === 'string' ? { ...maybeOptions, token: tokenOrOptions } : tokenOrOptions ?? {};
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !options.dangerouslyAllowBrowser) {
      throw new Error('CopsClient refuses to run in a browser: the API token would be exposed to every visitor. Call the API from a server, or pass dangerouslyAllowBrowser: true if you accept that risk.');
    }
    const env = typeof process !== 'undefined' ? process.env : {};
    const token = (options.token ?? env.COPS_API_TOKEN)?.trim() || undefined;
    if (!token) {
      throw new CopsApiError('missing_token', 'CopsClient needs your own Critical Ops API token: new CopsClient("cops_...") or set COPS_API_TOKEN. Tokens are issued by Critical Force to a Critical Ops account.', 0, null, { local: true });
    }
    if (options.validateToken !== false && !TOKEN_PATTERN.test(token)) {
      throw new CopsApiError('invalid_token', 'That does not look like a Critical Ops API token: tokens are "cops_" followed by 48 hex digits. Pass validateToken: false if the format has changed.', 0, null, { local: true });
    }
    this.baseUrl = (options.baseUrl ?? env.COPS_API_BASE ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.quotaTracker = new QuotaTracker(options.rateLimit);
    this.maxPlayersPerRequest = Math.max(1, options.maxPlayersPerRequest ?? 20);
    this.transport = new Transport({
      token,
      baseUrl: this.baseUrl,
      timeoutMs: options.timeoutMs ?? 10_000,
      retries: options.retries ?? 2,
      gatewayRetries: options.gatewayRetries ?? 5,
      maxRateLimitWaitSec: options.maxRateLimitWaitSec ?? 15,
      authHeader: options.authHeader ?? 'bearer',
      userAgent: options.userAgent === undefined ? `copsapi-wrapper/${VERSION}` : options.userAgent,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      quota: this.quotaTracker,
      maxConcurrent: options.maxConcurrent ?? 8,
      dedupe: options.dedupe ?? true,
      hooks: options.hooks ?? {},
    });
    this.store = options.cache === false ? null : options.cache?.store ?? new MemoryCache();
    this.ttl = { ...DEFAULT_TTLS, ...(options.cache === false ? {} : options.cache?.ttl) };

    this.profiles = new ProfilesApi(this);
    this.servers = new ServersApi(this);
    this.matches = new MatchesApi(this);
    this.stats = new StatsApi(this);
    this.leaderboards = new LeaderboardsApi(this);
    this.autohost = new AutohostApi(this);
  }

  get hasToken(): boolean {
    return this.transport.hasToken;
  }

  get quota(): QuotaSnapshot {
    return this.quotaTracker.snapshot();
  }

  request<T>(path: string, opts: { method?: 'GET' | 'POST'; query?: Record<string, QueryValue>; body?: unknown; priority?: Priority; signal?: AbortSignal; authenticated?: boolean } = {}): Promise<T> {
    return this.transport.request<T>(path, opts);
  }

  openApiSpec(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request('/openapi.json', { authenticated: false, signal });
  }

  static async fetchOpenApiSpec(opts: { baseUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await (opts.fetch ?? globalThis.fetch)(`${base}/openapi.json`, { headers: { Accept: 'application/json' }, signal: opts.signal });
    if (!res.ok) throw new CopsApiError('gateway', `Could not fetch the OpenAPI document (${res.status}).`, res.status);
    return (await res.json()) as Record<string, unknown>;
  }

  get autohostPermission(): boolean | null {
    return this.autohostAllowed;
  }

  setAutohostPermission(allowed: boolean | null): void {
    this.autohostAllowed = allowed;
  }

  async verifyToken(signal?: AbortSignal): Promise<TokenCheck> {
    try {
      await this.servers.list({ fresh: true, signal });
    } catch (err) {
      if (isCopsError(err, 'missing_token', 'invalid_token', 'token_revoked')) return { valid: false, autohost: false, error: err, quota: this.quota };
      throw err;
    }
    const autohost = await this.autohost.isAvailable({ fresh: true, signal });
    return { valid: true, autohost, error: null, quota: this.quota };
  }

  async clearCache(): Promise<void> {
    await this.store?.clear?.();
  }

  toJSON() {
    return { baseUrl: this.baseUrl, hasToken: this.hasToken };
  }

  async cached<T>(key: string, ttl: keyof CacheTtls, fresh: boolean | undefined, load: () => Promise<T>): Promise<T> {
    if (this.store && !fresh) {
      const hit = (await this.store.get(key)) as T | undefined;
      if (hit !== undefined) return hit;
    }
    const value = await load();
    if (this.store) await this.store.set(key, value, this.ttl[ttl]);
    return value;
  }

  async cacheGet<T>(key: string): Promise<T | undefined> {
    return this.store ? ((await this.store.get(key)) as T | undefined) : undefined;
  }

  async cacheSet(key: string, value: unknown, ttl: keyof CacheTtls): Promise<void> {
    if (this.store) await this.store.set(key, value, this.ttl[ttl]);
  }
}

class ProfilesApi {
  constructor(private readonly client: CopsClient) {}

  async get(player: PlayerRef, opts: CallOptions = {}): Promise<Profile> {
    const [profile] = await this.many([player], { ...opts, skipMissing: false });
    if (!profile) throw new CopsApiError('user_not_found', `No Critical Ops player ${JSON.stringify(player)}.`, 404, null, { path: '/profile', method: 'GET' });
    return profile;
  }

  async find(player: PlayerRef, opts: CallOptions = {}): Promise<Profile | null> {
    const [profile] = await this.many([player], opts);
    return profile ?? null;
  }

  async many(players: readonly PlayerRef[], opts: CallOptions & { skipMissing?: boolean } = {}): Promise<Profile[]> {
    const skipMissing = opts.skipMissing ?? true;
    const refs = dedupeRefs(players);
    const found = new Map<string, Profile>();
    const missing: PlayerRef[] = [];
    for (const ref of refs) {
      const hit = opts.fresh ? undefined : await this.client.cacheGet<Profile>(refKey(ref));
      if (hit) found.set(refKey(ref), hit);
      else missing.push(ref);
    }
    for (const group of chunk(missing, this.client.maxPlayersPerRequest)) {
      const loaded = await this.load(group, skipMissing, opts);
      for (const [ref, profile] of loaded) {
        found.set(refKey(ref), profile);
        await this.client.cacheSet(refKey(ref), profile, 'profile');
        await this.client.cacheSet(refKey(profile.basic_info.user_id), profile, 'profile');
      }
    }
    const seen = new Set<number>();
    const out: Profile[] = [];
    for (const ref of refs) {
      const p = found.get(refKey(ref));
      if (p && !seen.has(p.basic_info.user_id)) {
        seen.add(p.basic_info.user_id);
        out.push(p);
      }
    }
    return out;
  }

  async byIds(ids: readonly number[], opts: CallOptions = {}): Promise<Map<number, Profile>> {
    const list = await this.many(ids, opts);
    return new Map(list.map((p) => [p.basic_info.user_id, p]));
  }

  async byUsernames(names: readonly string[], opts: CallOptions = {}): Promise<Map<string, Profile>> {
    const list = await this.many(names, opts);
    const byLower = new Map(list.map((p) => [p.basic_info.name.toLowerCase(), p]));
    const out = new Map<string, Profile>();
    for (const name of names) {
      const p = byLower.get(name.trim().toLowerCase());
      if (p) out.set(name, p);
    }
    return out;
  }

  private async load(refs: PlayerRef[], skipMissing: boolean, opts: CallOptions): Promise<[PlayerRef, Profile][]> {
    try {
      const list = await this.client.request<Profile[]>('/profile', {
        query: { ids: refs.filter(isId), usernames: refs.filter((r): r is string => !isId(r)) },
        priority: opts.priority,
        signal: opts.signal,
      });
      return matchRefs(refs, list);
    } catch (err) {
      if (!skipMissing || !isCopsError(err, 'user_not_found')) throw err;
      if (refs.length <= 1) return [];
      const mid = Math.ceil(refs.length / 2);
      return [...(await this.load(refs.slice(0, mid), true, opts)), ...(await this.load(refs.slice(mid), true, opts))];
    }
  }
}

function refKey(ref: PlayerRef): string {
  return isId(ref) ? `profile:id:${ref}` : `profile:name:${ref.trim().toLowerCase()}`;
}

function dedupeRefs(players: readonly PlayerRef[]): PlayerRef[] {
  const seen = new Set<string>();
  const out: PlayerRef[] = [];
  for (const raw of players) {
    if (isId(raw) && !(Number.isInteger(raw) && raw > 0)) throw new CopsApiError('bad_request', `Invalid player id ${raw}.`, 0, null, { path: '/profile', local: true });
    const ref = isId(raw) ? raw : raw.trim();
    if (ref === '') continue;
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function matchRefs(refs: PlayerRef[], list: Profile[]): [PlayerRef, Profile][] {
  const byId = new Map(list.map((p) => [p.basic_info.user_id, p]));
  const byName = new Map(list.map((p) => [p.basic_info.name.toLowerCase(), p]));
  const out: [PlayerRef, Profile][] = [];
  const ids = refs.filter(isId);
  const names = refs.filter((r): r is string => !isId(r));
  for (const id of ids) {
    const p = byId.get(id);
    if (p) out.push([id, p]);
  }
  const unmatched = list.filter((p) => !ids.includes(p.basic_info.user_id));
  names.forEach((name, i) => {
    const p = byName.get(name.toLowerCase()) ?? unmatched[i];
    if (p) out.push([name, p]);
  });
  return out;
}

class ServersApi {
  constructor(private readonly client: CopsClient) {}

  list(opts: CallOptions = {}): Promise<GameServer[]> {
    return this.client.cached('servers', 'servers', opts.fresh, async () => {
      const raw = await this.client.request<Record<string, ServerStatus>>('/status/servers', { priority: opts.priority, signal: opts.signal });
      return Object.entries(raw)
        .map(([id, s]) => ({ id: Number(id), name: String(s.name), online: s.status === 'online', region: regionOf(String(s.name)) }))
        .filter((s) => Number.isInteger(s.id))
        .sort((a, b) => a.id - b.id);
    });
  }

  async online(opts: CallOptions = {}): Promise<GameServer[]> {
    return (await this.list(opts)).filter((s) => s.online);
  }

  async get(id: number, opts: CallOptions = {}): Promise<GameServer | null> {
    return (await this.list(opts)).find((s) => s.id === id) ?? null;
  }

  async pick(opts: CallOptions & { region?: Region; name?: string | RegExp; fallbackToAny?: boolean } = {}): Promise<GameServer | null> {
    const online = await this.online(opts);
    const matches = online.filter((s) => {
      if (opts.region && s.region !== opts.region) return false;
      if (opts.name instanceof RegExp) return opts.name.test(s.name);
      if (typeof opts.name === 'string') return s.name.toLowerCase().includes(opts.name.toLowerCase());
      return true;
    });
    if (matches.length) return matches[Math.floor(Math.random() * matches.length)] ?? null;
    return opts.fallbackToAny === false ? null : online[0] ?? null;
  }
}

class MatchesApi {
  constructor(private readonly client: CopsClient) {}

  history(userId: number, opts: CallOptions = {}): Promise<MatchHistoryEntry[]> {
    return this.client.cached(`history:${userId}`, 'history', opts.fresh, async () =>
      (await this.client.request<{ matches: MatchHistoryEntry[] }>('/matches/player', { query: { user_id: userId }, priority: opts.priority, signal: opts.signal })).matches,
    );
  }

  async get(ids: readonly string[], opts: CallOptions = {}): Promise<MatchInfo[]> {
    const want = [...new Set(ids.map((id) => id.trim().toLowerCase()))];
    for (const id of want) {
      if (!/^[0-9a-f]{64}$/.test(id)) throw new CopsApiError('bad_request', `Invalid match id ${JSON.stringify(id)}: expected 64 hex digits.`, 0, null, { path: '/matches/fetch', local: true });
    }
    const found = new Map<string, MatchInfo>();
    const missing: string[] = [];
    for (const id of want) {
      const hit = opts.fresh ? undefined : await this.client.cacheGet<MatchInfo>(`match:${id}`);
      if (hit) found.set(id, hit);
      else missing.push(id);
    }
    for (const group of chunk(missing, 20)) {
      const { matches } = await this.client.request<{ matches: MatchInfo[] }>('/matches/fetch', { query: { ids: group }, priority: opts.priority, signal: opts.signal });
      for (const m of matches) {
        found.set(m.id.toLowerCase(), m);
        await this.client.cacheSet(`match:${m.id.toLowerCase()}`, m, 'match');
      }
    }
    return want.map((id) => found.get(id)).filter((m): m is MatchInfo => !!m);
  }

  async one(id: string, opts: CallOptions = {}): Promise<MatchInfo | null> {
    return (await this.get([id], opts))[0] ?? null;
  }

  async recent(userId: number, opts: CallOptions & { limit?: number; gameType?: GameTypeName | GameTypeCode } = {}): Promise<{ entry: MatchHistoryEntry; match: MatchInfo | null }[]> {
    let history = await this.history(userId, opts);
    if (opts.gameType !== undefined) {
      const code = gameTypeCode(opts.gameType);
      history = history.filter((h) => h.game_type === code);
    }
    history = history.slice(0, opts.limit ?? 5);
    const matches = await this.get(history.map((h) => h.id), opts);
    const byId = new Map(matches.map((m) => [m.id.toLowerCase(), m]));
    return history.map((entry) => ({ entry, match: byId.get(entry.id.toLowerCase()) ?? null }));
  }
}

class StatsApi {
  constructor(private readonly client: CopsClient) {}

  weapons(userId: number, gameType: GameTypeName | GameTypeCode = 'ranked', opts: CallOptions = {}): Promise<WeaponStats[]> {
    const code = gameTypeCode(gameType);
    return this.client.cached(`weapons:${userId}:${code}`, 'weapons', opts.fresh, async () =>
      (await this.client.request<{ weapons: WeaponStats[] }>('/stats/weapons', { query: { user_id: userId, game_type: code }, priority: opts.priority, signal: opts.signal })).weapons,
    );
  }

  async topWeapons(userId: number, opts: CallOptions & { gameType?: GameTypeName | GameTypeCode; by?: 'k' | 'a' | 'h'; limit?: number } = {}): Promise<(WeaponStats & { headshotRate: number })[]> {
    const list = await this.weapons(userId, opts.gameType ?? 'ranked', opts);
    const by = opts.by ?? 'k';
    return [...list]
      .sort((a, b) => b[by] - a[by])
      .slice(0, opts.limit ?? 5)
      .map((w) => ({ ...w, headshotRate: w.k ? Math.round((w.h / w.k) * 1000) / 1000 : 0 }));
  }
}

class LeaderboardsApi {
  constructor(private readonly client: CopsClient) {}

  page(type: LeaderboardType, opts: CallOptions & { page?: number; rank?: number } = {}): Promise<LeaderboardPage> {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const rank = opts.rank ?? null;
    if (rank !== null && !(Number.isInteger(rank) && rank >= 0 && rank <= 9)) {
      return Promise.reject(new CopsApiError('bad_request', `rank must be 0 to 9, got ${rank}.`, 0, null, { path: '/leaderboards', local: true }));
    }
    return this.client.cached(`leaderboard:${type}:${rank ?? 'all'}:${page}`, 'leaderboard', opts.fresh, async () => {
      const res = await this.client.request<{ entries: LeaderboardEntry[]; leaderboard_size: number }>('/leaderboards', {
        query: { type, page, rank: rank ?? undefined },
        priority: opts.priority,
        signal: opts.signal,
      });
      return { type, page, rank, size: res.leaderboard_size, pages: Math.ceil(res.leaderboard_size / 10), entries: res.entries };
    });
  }

  async *iterate(type: LeaderboardType, opts: CallOptions & { rank?: number; startPage?: number; maxPages?: number } = {}): AsyncGenerator<LeaderboardEntry, void, undefined> {
    const seen = new Set<number>();
    const maxPages = opts.maxPages ?? Infinity;
    let page = opts.startPage ?? 1;
    for (let fetched = 0; fetched < maxPages; fetched++, page++) {
      const result = await this.page(type, { ...opts, page });
      if (!result.entries.length) return;
      for (const entry of result.entries) {
        if (seen.has(entry.basic_info.user_id)) continue;
        seen.add(entry.basic_info.user_id);
        yield entry;
      }
      if (page >= result.pages) return;
    }
  }

  async top(type: LeaderboardType, count = 10, opts: CallOptions & { rank?: number } = {}): Promise<LeaderboardEntry[]> {
    const out: LeaderboardEntry[] = [];
    for await (const entry of this.iterate(type, { ...opts, maxPages: Math.ceil(count / 10) + 1 })) {
      out.push(entry);
      if (out.length >= count) break;
    }
    return out;
  }
}

class AutohostApi {
  constructor(private readonly client: CopsClient) {}

  async isAvailable(opts: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<boolean> {
    const known = this.client.autohostPermission;
    if (known !== null && !opts.fresh) return known;
    try {
      await this.client.request('/autohost/poll', { query: { ids: [1] }, priority: 'high', signal: opts.signal });
      this.client.setAutohostPermission(true);
    } catch (err) {
      if (isCopsError(err, 'insufficient_permissions')) this.client.setAutohostPermission(false);
      else if (isCopsError(err, 'game_not_found', 'bad_request')) this.client.setAutohostPermission(true);
      else throw err;
    }
    return this.client.autohostPermission === true;
  }

  private async call<T>(path: string, run: () => Promise<T>): Promise<T> {
    if (this.client.autohostPermission === false) {
      throw new CopsApiError('insufficient_permissions', AUTOHOST_DENIED, 403, null, { path, local: true });
    }
    try {
      const result = await run();
      this.client.setAutohostPermission(true);
      return result;
    } catch (err) {
      if (isCopsError(err, 'insufficient_permissions') && !err.local) {
        this.client.setAutohostPermission(false);
        throw new CopsApiError('insufficient_permissions', AUTOHOST_DENIED, err.status, null, { path, method: err.method, cause: err });
      }
      throw err;
    }
  }

  async create(opts: HostOptions): Promise<AutohostGame> {
    const mode = gameMode(opts.mode);
    const map = mapId(opts.map);
    const validate = opts.validate ?? true;
    const gameModeId = mode?.id ?? (typeof opts.mode === 'number' ? opts.mode : NaN);
    const mapIdValue = map ?? (typeof opts.map === 'number' ? opts.map : NaN);
    const local = (message: string) => new CopsApiError('bad_request', message, 0, null, { path: '/autohost/create', method: 'POST', local: true });
    if (!Number.isInteger(gameModeId)) throw local(`Unknown game mode ${JSON.stringify(opts.mode)}.`);
    if (!Number.isInteger(mapIdValue)) throw local(`Unknown map ${JSON.stringify(opts.map)}.`);
    if (validate && !isHostable(gameModeId, mapIdValue)) {
      throw local(`${mode?.name ?? `Game mode ${gameModeId}`} cannot be hosted on ${mapName(mapIdValue) ?? `map ${mapIdValue}`}. Pass validate: false if the API has added it since this release.`);
    }
    if (!opts.roomName.trim()) throw local('roomName must not be empty.');
    const res = await this.call('/autohost/create', () =>
      this.client.request<{ autohost: AutohostGame }>('/autohost/create', {
        method: 'POST',
        priority: 'high',
        signal: opts.signal,
        body: { server_id: opts.serverId, room_name: opts.roomName, password: opts.password ?? '', map_id: mapIdValue, game_mode_id: gameModeId },
      }),
    );
    return res.autohost;
  }

  async poll(ids: readonly number[], opts: { signal?: AbortSignal } = {}): Promise<AutohostGame[]> {
    const unique = [...new Set(ids)];
    const out: AutohostGame[] = [];
    for (const group of chunk(unique, 50)) {
      const res = await this.call('/autohost/poll', () =>
        this.client.request<{ autohosts: AutohostGame[] }>('/autohost/poll', { query: { ids: group }, priority: 'high', signal: opts.signal }),
      );
      out.push(...res.autohosts);
    }
    return out;
  }

  async get(id: number, opts: { signal?: AbortSignal } = {}): Promise<AutohostGame | null> {
    return (await this.poll([id], opts))[0] ?? null;
  }

  async control(id: number, command: AutohostCommand, userId: number | null = null, opts: { signal?: AbortSignal } = {}): Promise<AutohostGame> {
    if ((command === 'kick' || command === 'room_owner_add' || command === 'room_owner_remove') && userId == null) {
      throw new CopsApiError('bad_request', `${command} needs a user id.`, 0, null, { path: '/autohost/control', method: 'POST', local: true });
    }
    const res = await this.call('/autohost/control', () =>
      this.client.request<{ autohost: AutohostGame }>('/autohost/control', { method: 'POST', priority: 'high', signal: opts.signal, body: { id, command, user_id: userId } }),
    );
    return res.autohost;
  }

  kick(id: number, userId: number) {
    return this.control(id, 'kick', userId);
  }

  restart(id: number) {
    return this.control(id, 'restart');
  }

  addOwner(id: number, userId: number) {
    return this.control(id, 'room_owner_add', userId);
  }

  removeOwner(id: number, userId: number) {
    return this.control(id, 'room_owner_remove', userId);
  }

  close(id: number) {
    return this.control(id, 'close');
  }

  async waitForRoom(id: number, opts: WaitForRoomOptions = {}): Promise<AutohostGame> {
    const timeoutMs = opts.timeoutMs ?? 35_000;
    const intervalMs = Math.max(500, opts.intervalMs ?? 1500);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const game = await this.get(id, { signal: opts.signal });
      if (game?.room.code) return game;
      if (game?.status === 'ended') {
        throw new CopsApiError('game_rejected', `The game server refused game ${id}: ${game.rejection_reason ?? 'no reason given'}.`, 0, null, { path: '/autohost/poll' });
      }
      if (Date.now() + intervalMs > deadline) {
        if (!game) throw new CopsApiError('game_gone', `Game ${id} is gone: the game server never created its room.`, 0, null, { path: '/autohost/poll' });
        throw new CopsApiError('timeout', `Game ${id} had no room code after ${timeoutMs} ms.`, 0, null, { path: '/autohost/poll' });
      }
      await sleep(intervalMs, opts.signal);
    }
  }

  async host(opts: HostAndWaitOptions): Promise<HostedRoom> {
    const password = opts.password === false ? null : opts.password ?? randomPassword();
    const created = await this.create({ ...opts, password: password ?? '' });
    const game = await this.waitForRoom(created.id, { timeoutMs: opts.timeoutMs, intervalMs: opts.intervalMs, signal: opts.signal });
    let latest = game;
    for (const owner of opts.owners ?? []) latest = await this.addOwner(created.id, owner);
    return { id: created.id, code: game.room.code as string, password, serverId: created.server_id, game: latest.room.code ? latest : game };
  }

  watch(opts: WatcherOptions = {}): AutohostWatcher {
    return new AutohostWatcher(this.client, opts);
  }
}

export type { ProfilesApi, ServersApi, MatchesApi, StatsApi, LeaderboardsApi, AutohostApi };
