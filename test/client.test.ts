import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopsApiError, CopsClient, isCopsError, type CopsClientOptions } from '../src/index.js';
import { game, mockFetch, profile } from './helpers.js';

afterEach(() => vi.useRealTimers());

const TOKEN = 'cops_' + '0'.repeat(48);
const make = (handler: Parameters<typeof mockFetch>[0], extra: CopsClientOptions = {}) => {
  const mock = mockFetch(handler);
  return { cops: new CopsClient({ token: TOKEN, fetch: mock.fetch, ...extra }), calls: mock.calls };
};

describe('transport', () => {
  it('sends the token as a bearer header, or as X-Api-Key when asked', async () => {
    const a = make(() => ({ json: {} }));
    await a.cops.servers.list();
    expect(a.calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const b = make(() => ({ json: {} }), { authHeader: 'x-api-key' });
    await b.cops.servers.list();
    expect(b.calls[0]!.headers['X-Api-Key']).toBe(TOKEN);
    expect(b.calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('requires the user to supply their own token', () => {
    const saved = process.env.COPS_API_TOKEN;
    delete process.env.COPS_API_TOKEN;
    try {
      expect(() => new CopsClient()).toThrow(expect.objectContaining({ code: 'missing_token' }));
      expect(() => new CopsClient({ token: '  ' })).toThrow(expect.objectContaining({ code: 'missing_token' }));
    } finally {
      if (saved !== undefined) process.env.COPS_API_TOKEN = saved;
    }
  });

  it('accepts the token as the first argument or as an option, and from COPS_API_TOKEN', async () => {
    const mock = mockFetch(() => ({ json: {} }));
    await new CopsClient(TOKEN, { fetch: mock.fetch }).servers.list();
    expect(mock.calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const saved = process.env.COPS_API_TOKEN;
    process.env.COPS_API_TOKEN = TOKEN;
    try {
      expect(new CopsClient({ fetch: mock.fetch }).hasToken).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.COPS_API_TOKEN;
      else process.env.COPS_API_TOKEN = saved;
    }
  });

  it('rejects tokens in the wrong format unless told not to check', () => {
    expect(() => new CopsClient('my-password')).toThrow(expect.objectContaining({ code: 'invalid_token' }));
    expect(new CopsClient('cops_future-format', { validateToken: false }).hasToken).toBe(true);
  });

  it('never exposes the token when the client is serialised', () => {
    const { cops } = make(() => ({ json: {} }));
    expect(JSON.stringify(cops)).not.toContain(TOKEN);
  });

  it('parses API errors into CopsApiError with the stable code', async () => {
    const { cops } = make(() => ({ status: 401, json: { error: { code: 'token_revoked', message: 'revoked' } } }));
    const err = await cops.servers.list().catch((e) => e);
    expect(isCopsError(err, 'token_revoked')).toBe(true);
    expect(err).toBeInstanceOf(CopsApiError);
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it('retries the front proxy answering a plain-text 404 and then succeeds', async () => {
    let n = 0;
    const { cops, calls } = make(() => (++n < 3 ? { status: 404, text: 'Endpoint Not Found.' } : { json: { 1: { name: 'EU-1', status: 'online' } } }));
    const servers = await cops.servers.list();
    expect(servers).toEqual([{ id: 1, name: 'EU-1', online: true, region: 'EU' }]);
    expect(calls).toHaveLength(3);
  });

  it('gives up on the gateway after the configured retries with a gateway error', async () => {
    const { cops, calls } = make(() => ({ status: 502, text: '<html>bad gateway</html>' }), { gatewayRetries: 2 });
    await expect(cops.servers.list()).rejects.toMatchObject({ code: 'gateway', status: 502 });
    expect(calls).toHaveLength(3);
  });

  it('retries network errors on GET but never on POST', async () => {
    let n = 0;
    const get = make(() => (++n === 1 ? new TypeError('fetch failed') : { json: {} }));
    await get.cops.servers.list();
    expect(get.calls).toHaveLength(2);
    const post = make(() => new TypeError('fetch failed'));
    await expect(post.cops.autohost.create({ serverId: 1, map: 'Canals', mode: 'tournament', roomName: 'x' })).rejects.toMatchObject({ code: 'network' });
    expect(post.calls).toHaveLength(1);
  });

  it('does not retry API 500s for POST requests, because the game might already exist', async () => {
    const { cops, calls } = make(() => ({ status: 500, json: { error: { code: 'internal_error', message: 'x' } } }));
    await expect(cops.autohost.close(5)).rejects.toMatchObject({ code: 'internal_error' });
    expect(calls).toHaveLength(1);
  });

  it('waits out a short 429 and retries', async () => {
    vi.useFakeTimers();
    {
      let n = 0;
      const { cops, calls } = make(() =>
        ++n === 1 ? { status: 429, headers: { 'retry-after': '2' }, json: { error: { code: 'rate_limited', message: 'slow', retry_after: 2 } } } : { json: {} },
      );
      const job = cops.servers.list();
      await vi.advanceTimersByTimeAsync(2100);
      await job;
      expect(calls).toHaveLength(2);
    }
  });

  it('throws on a 429 longer than maxRateLimitWaitSec', async () => {
    const { cops } = make(() => ({ status: 429, headers: { 'retry-after': '40' }, json: { error: { code: 'rate_limited', message: 'slow', retry_after: 40 } } }), { maxRateLimitWaitSec: 5 });
    await expect(cops.servers.list()).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 40 });
  });

  it('tracks the quota from the response headers', async () => {
    const reset = Math.floor(Date.now() / 1000) + 30;
    const { cops } = make(() => ({ json: {}, headers: { 'x-ratelimit-limit': '120', 'x-ratelimit-remaining': '77', 'x-ratelimit-reset': String(reset) } }));
    await cops.servers.list();
    expect(cops.quota).toMatchObject({ limit: 120, remaining: 77 });
    expect(cops.quota.resetAt.getTime()).toBe(reset * 1000);
  });

  it('keeps the reserve for high-priority autohost calls', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 50);
    const { cops } = make(() => ({ json: { autohosts: [] }, headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': reset } }), {
      rateLimit: { reserve: 5, onExhausted: 'throw' },
    });
    await cops.autohost.poll([1]);
    await expect(cops.servers.list()).rejects.toMatchObject({ code: 'rate_limited', local: true });
    await expect(cops.autohost.poll([1])).resolves.toEqual([]);
  });

  it('collapses identical GET requests made at the same time into one', async () => {
    const { cops, calls } = make(async () => ({ json: { 1: { name: 'EU-1', status: 'online' } } }), { cache: false });
    await Promise.all([cops.servers.list(), cops.servers.list(), cops.servers.list()]);
    expect(calls).toHaveLength(1);
  });

  it('times out slow requests', async () => {
    const { cops } = make(() => new Promise(() => undefined), { timeoutMs: 50, retries: 0 });
    await expect(cops.servers.list()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('honours an AbortSignal', async () => {
    const controller = new AbortController();
    const { cops } = make(() => new Promise(() => undefined));
    const job = cops.matches.history(1, { signal: controller.signal });
    controller.abort();
    await expect(job).rejects.toMatchObject({ code: 'aborted' });
  });

  it('fetches the OpenAPI document without sending the token', async () => {
    const { cops, calls } = make(() => ({ json: { openapi: '3.1.0' } }));
    await expect(cops.openApiSpec()).resolves.toEqual({ openapi: '3.1.0' });
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    const mock = mockFetch(() => ({ json: { openapi: '3.1.0' } }));
    await expect(CopsClient.fetchOpenApiSpec({ fetch: mock.fetch })).resolves.toEqual({ openapi: '3.1.0' });
  });
});

describe('profiles', () => {
  it('splits big lookups into requests of 20 and returns profiles in request order', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    const { cops, calls } = make((call) => ({ json: call.query.get('ids')!.split(',').map((id) => profile(Number(id))) }));
    const list = await cops.profiles.many(ids);
    expect(list.map((p) => p.basic_info.user_id)).toEqual(ids);
    expect(calls.map((c) => c.query.get('ids')!.split(',').length)).toEqual([20, 20, 5]);
  });

  it('mixes ids and usernames in one request', async () => {
    const { cops, calls } = make(() => ({ json: [profile(1), profile(2, 'Alice')] }));
    const list = await cops.profiles.many([1, 'Alice']);
    expect(list.map((p) => p.basic_info.name)).toEqual(['player1', 'Alice']);
    expect(calls[0]!.query.get('ids')).toBe('1');
    expect(calls[0]!.query.get('usernames')).toBe('Alice');
  });

  it('isolates unknown players instead of failing the whole batch', async () => {
    const { cops } = make((call) => {
      const ids = call.query.get('ids')!.split(',').map(Number);
      if (ids.includes(13)) return { status: 404, json: { error: { code: 'user_not_found', message: 'nope' } } };
      return { json: ids.map((id) => profile(id)) };
    });
    const list = await cops.profiles.many([11, 12, 13, 14]);
    expect(list.map((p) => p.basic_info.user_id)).toEqual([11, 12, 14]);
    await expect(cops.profiles.get(13)).rejects.toMatchObject({ code: 'user_not_found' });
    await expect(cops.profiles.find(13)).resolves.toBeNull();
  });

  it('caches profiles by id and by name', async () => {
    const { cops, calls } = make(() => ({ json: [profile(5, 'Bob')] }));
    await cops.profiles.get('Bob');
    await cops.profiles.get(5);
    await cops.profiles.get('bob');
    expect(calls).toHaveLength(1);
    await cops.profiles.get(5, { fresh: true });
    expect(calls).toHaveLength(2);
  });

  it('rejects invalid ids before calling the API', async () => {
    const { cops, calls } = make(() => ({ json: [] }));
    await expect(cops.profiles.many([0])).rejects.toMatchObject({ code: 'bad_request', local: true });
    expect(calls).toHaveLength(0);
  });
});

describe('matches, stats and leaderboards', () => {
  const MID = 'a'.repeat(64);

  it('validates match ids and caches finished matches', async () => {
    const { cops, calls } = make(() => ({ json: { matches: [{ id: MID, players: [] }] } }));
    await expect(cops.matches.get(['nope'])).rejects.toMatchObject({ code: 'bad_request' });
    await cops.matches.one(MID);
    await cops.matches.one(MID.toUpperCase());
    expect(calls).toHaveLength(1);
  });

  it('combines history with scoreboards in recent()', async () => {
    const { cops } = make((call) =>
      call.path === '/matches/player'
        ? { json: { matches: [{ id: MID, game_type: 1 }, { id: 'b'.repeat(64), game_type: 2 }] } }
        : { json: { matches: [{ id: MID, players: [] }] } },
    );
    const recent = await cops.matches.recent(1, { gameType: 'ranked' });
    expect(recent).toHaveLength(1);
    expect(recent[0]!.match?.id).toBe(MID);
  });

  it('maps game type names to codes for weapon stats', async () => {
    const { cops, calls } = make(() => ({ json: { weapons: [{ weapon_id: 1, name: 'AK47', k: 10, a: 1, h: 4 }, { weapon_id: 2, name: 'M4', k: 20, a: 0, h: 5 }] } }));
    const top = await cops.stats.topWeapons(7, { gameType: 'casual', limit: 1 });
    expect(calls[0]!.query.get('game_type')).toBe('2');
    expect(top).toEqual([{ weapon_id: 2, name: 'M4', k: 20, a: 0, h: 5, headshotRate: 0.25 }]);
  });

  it('pages through a leaderboard, skipping players who moved between pages', async () => {
    const pages: Record<string, number[]> = { 1: [1, 2], 2: [2, 3], 3: [] };
    const { cops } = make((call) => ({
      json: { leaderboard_size: 25, entries: (pages[call.query.get('page')!] ?? []).map((id, i) => ({ position: i + 1, score: 100 - id, basic_info: { user_id: id }, ranked: {} })) },
    }));
    const seen: number[] = [];
    for await (const e of cops.leaderboards.iterate('mmr')) seen.push(e.basic_info.user_id);
    expect(seen).toEqual([1, 2, 3]);
    const page = await cops.leaderboards.page('mmr', { page: 2 });
    expect(page).toMatchObject({ page: 2, pages: 3, size: 25 });
    await expect(cops.leaderboards.page('mmr', { rank: 12 })).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('autohost', () => {
  it('accepts map and mode names and sends API ids', async () => {
    const { cops, calls } = make(() => ({ status: 202, json: { autohost: game(9) } }));
    await cops.autohost.create({ serverId: 3, map: 'castello', mode: 'Tournament Mode', roomName: 'Final', password: 'pw' });
    expect(calls[0]!.body).toEqual({ server_id: 3, room_name: 'Final', password: 'pw', map_id: 15391, game_mode_id: 15847 });
  });

  it('refuses map and mode combinations the API does not host', async () => {
    const { cops, calls } = make(() => ({ json: {} }));
    await expect(cops.autohost.create({ serverId: 3, map: 'Heat', mode: 'tournament', roomName: 'x' })).rejects.toMatchObject({ code: 'bad_request', local: true });
    expect(calls).toHaveLength(0);
    await cops.autohost.create({ serverId: 3, map: 4483, mode: 15847, roomName: 'x', validate: false }).catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it('polls in batches of 50', async () => {
    const { cops, calls } = make((call) => ({ json: { autohosts: call.query.get('ids')!.split(',').map((id) => game(Number(id))) } }));
    const games = await cops.autohost.poll(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(games).toHaveLength(120);
    expect(calls.map((c) => c.query.get('ids')!.split(',').length)).toEqual([50, 50, 20]);
  });

  it('requires a user id for player commands', async () => {
    const { cops, calls } = make(() => ({ json: { autohost: game(1) } }));
    await expect(cops.autohost.control(1, 'kick')).rejects.toMatchObject({ code: 'bad_request' });
    await cops.autohost.kick(1, 55);
    expect(calls[0]!.body).toEqual({ id: 1, command: 'kick', user_id: 55 });
  });

  it('hosts, waits for the room code and adds owners', async () => {
    let polls = 0;
    const { cops, calls } = make((call) => {
      if (call.path === '/autohost/create') return { status: 202, json: { autohost: game(4, { room: { ...game(4).room, id: -1, code: null } }) } };
      if (call.path === '/autohost/poll') return { json: { autohosts: [++polls < 2 ? game(4, { room: { ...game(4).room, id: -1, code: null } }) : game(4)] } };
      return { json: { autohost: game(4) } };
    });
    const room = await cops.autohost.host({ serverId: 3, map: 'Canals', mode: 'tournament', roomName: 'Final', owners: [77], intervalMs: 500 });
    expect(room).toMatchObject({ id: 4, code: 'ABC123' });
    expect(room.password).toMatch(/^[A-Z2-9]{6}$/);
    expect(calls.at(-1)!.body).toEqual({ id: 4, command: 'room_owner_add', user_id: 77 });
  });

  it('reports a game the server refused', async () => {
    const { cops } = make(() => ({ json: { autohosts: [game(4, { status: 'ended', room: { ...game(4).room, id: -1, code: null }, rejection_reason: 'ServerFull' })] } }));
    await expect(cops.autohost.waitForRoom(4)).rejects.toMatchObject({ code: 'game_rejected' });
  });
});

describe('tokens without the Autohost permission', () => {
  const denied = { status: 403, json: { error: { code: 'insufficient_permissions', message: 'Missing permission Autohost' } } };

  it('explains the missing permission and stops calling hosting endpoints', async () => {
    const { cops, calls } = make((call) => (call.path.startsWith('/autohost') ? denied : { json: {} }));
    const err = await cops.autohost.create({ serverId: 1, map: 'Canals', mode: 'tournament', roomName: 'x' }).catch((e) => e);
    expect(err).toMatchObject({ code: 'insufficient_permissions', status: 403 });
    expect(err.message).toContain('Autohost permission');
    expect(cops.autohostPermission).toBe(false);
    await expect(cops.autohost.poll([1])).rejects.toMatchObject({ code: 'insufficient_permissions', local: true });
    expect(calls).toHaveLength(1);
    await cops.servers.list();
    expect(calls).toHaveLength(2);
  });

  it('isAvailable() checks the permission once and remembers it', async () => {
    const denyingToken = make((call) => (call.path.startsWith('/autohost') ? denied : { json: {} }));
    await expect(denyingToken.cops.autohost.isAvailable()).resolves.toBe(false);
    await expect(denyingToken.cops.autohost.isAvailable()).resolves.toBe(false);
    expect(denyingToken.calls).toHaveLength(1);
    const hostingToken = make(() => ({ json: { autohosts: [] } }));
    await expect(hostingToken.cops.autohost.isAvailable()).resolves.toBe(true);
  });

  it('verifyToken() reports whether the token works and whether it can host', async () => {
    const ok = make((call) => (call.path.startsWith('/autohost') ? denied : { json: {} }));
    await expect(ok.cops.verifyToken()).resolves.toMatchObject({ valid: true, autohost: false, error: null });
    const revoked = make(() => ({ status: 401, json: { error: { code: 'token_revoked', message: 'revoked' } } }));
    const check = await revoked.cops.verifyToken();
    expect(check).toMatchObject({ valid: false, autohost: false });
    expect(check.error?.code).toBe('token_revoked');
  });
});
