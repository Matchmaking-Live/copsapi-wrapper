import type { AutohostGame, PlayerMatchStats, Profile } from '../src/index.js';

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | Error;
export type Handler = (call: Call) => Reply | Promise<Reply>;

export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname.replace(/^.*\/api\/public\/v2/, ''),
      query: url.searchParams,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const signal = init.signal;
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    });
    aborted.catch(() => undefined);
    const reply = await Promise.race([handler(call), aborted]);
    if (reply instanceof Error) throw reply;
    const body = reply.text ?? (reply.json !== undefined ? JSON.stringify(reply.json) : '');
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

export function profile(id: number, name = `player${id}`): Profile {
  const stats = { k: 10, d: 5, a: 2, w: 3, l: 1 };
  return {
    basic_info: { user_id: id, name, user_type: 1, icon_id: 0, player_level: { level: 50, current_xp: 1, next_level_xp: 2 }, last_seen_time: '' },
    account_age: '2y',
    blocked_friend_requests: false,
    blocked_clan_requests: false,
    party_invite_permissions: 0,
    ban: null,
    stats: {
      seasonal_stats: [
        { season: 0, ranked: stats, casual: stats, custom: stats },
        { season: 1, ranked: { k: 20, d: 10, a: 0, w: 2, l: 2 }, casual: stats, custom: stats },
      ],
      ranked: { placement_matches_left: 0, wins: 5, losses: 3, highest_rank: 6, mmr: 2400, global_position: 0, rank: 5 },
      leaderboard_data: { position: 0, score: 0 },
    },
  };
}

export function player(id: number, extra: Partial<PlayerMatchStats> = {}): PlayerMatchStats {
  return { user_id: id, team: 0, kills: 0, deaths: 0, assists: 0, damage_dealt: 0, input_device_flags: 1, left_match: false, leave_reason: null, ping: 40, user_type: 1, is_owner: false, ...extra };
}

export function game(id: number, extra: Partial<AutohostGame> = {}): AutohostGame {
  return {
    id,
    status: 'open',
    created_at: 1,
    updated_at: 1,
    ended_at: null,
    pending_expires_at: null,
    server_id: 3,
    room: { id: 7, code: 'ABC123', name: 'Room', map_id: 613, game_mode_id: 15847, has_password: true },
    player_count: 0,
    match_started_at: null,
    match_state: 'WaitingForPlayers',
    round: 0,
    scores: [0, 0],
    players: [],
    results: [],
    replay_id: null,
    rejection_reason: null,
    ...extra,
  };
}
