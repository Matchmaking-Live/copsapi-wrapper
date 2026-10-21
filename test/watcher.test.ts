import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopsClient, type AutohostGame } from '../src/index.js';
import { game, mockFetch, player } from './helpers.js';

let current: AutohostGame[] = [];
let fail: false | 'error' | 'denied' = false;

function setup(opts = {}) {
  const mock = mockFetch(() =>
    fail === 'denied'
      ? { status: 403, json: { error: { code: 'insufficient_permissions', message: 'x' } } }
      : fail
        ? { status: 500, json: { error: { code: 'internal_error', message: 'x' } } }
        : { json: { autohosts: current } },
  );
  const cops = new CopsClient({ token: 'cops_' + 'a'.repeat(48), fetch: mock.fetch, retries: 0 });
  return cops.autohost.watch({ missingGraceMs: 10_000, ...opts });
}

beforeEach(() => {
  current = [];
  fail = false;
});
afterEach(() => vi.useRealTimers());

describe('AutohostWatcher', () => {
  it('reports room readiness, joins with time since the room was ready, and leaves', async () => {
    vi.useFakeTimers();
    const w = setup().track(1);
    const events: string[] = [];
    w.on('roomReady', (g) => events.push(`ready ${g.room.code}`));
    w.on('playerJoin', (_g, p, j) => events.push(`join ${p.user_id} ${j.sinceRoomReadyMs}`));
    w.on('playerLeave', (_g, p) => events.push(`leave ${p.user_id}`));

    current = [game(1, { room: { ...game(1).room, id: -1, code: null } })];
    await w.pollNow();
    current = [game(1)];
    await w.pollNow();
    vi.advanceTimersByTime(90_000);
    current = [game(1, { players: [player(10)] })];
    await w.pollNow();
    current = [game(1, { players: [] })];
    await w.pollNow();

    expect(events).toEqual(['ready ABC123', 'join 10 90000', 'leave 10']);
    expect(w.joinTimes(1).get(10)?.sinceRoomReadyMs).toBe(90_000);
  });

  it('reports disconnects and reconnects from the ping', async () => {
    const w = setup().track(1);
    const events: string[] = [];
    w.on('playerDisconnect', (_g, p) => events.push(`dc ${p.user_id}`));
    w.on('playerReconnect', (_g, p) => events.push(`rc ${p.user_id}`));
    current = [game(1, { players: [player(10)] })];
    await w.pollNow();
    current = [game(1, { players: [player(10, { ping: -1 })] })];
    await w.pollNow();
    current = [game(1, { players: [player(10, { ping: 30 })] })];
    await w.pollNow();
    expect(events).toEqual(['dc 10', 'rc 10']);
  });

  it('emits state changes, scores and each match result once', async () => {
    const w = setup().track(1);
    const events: string[] = [];
    w.on('state', (_g, s, prev) => events.push(`state ${prev}->${s}`));
    w.on('score', (_g, round, scores) => events.push(`score ${round} ${scores.join('-')}`));
    w.on('matchResult', (_g, r, i) => events.push(`result ${i} ${r.scores.join('-')}`));
    const result = { match_id: 'm', map_id: 613, team_factions: [0, 1], winning_team: 0, win_condition: 'TeamKills', scores: [7, 3], started_at: 1, ended_at: 2, map_variation: 0, rounds_played: 10, players: [] };
    current = [game(1)];
    await w.pollNow();
    current = [game(1, { match_state: 'OnGoing', round: 2, scores: [1, 0] })];
    await w.pollNow();
    current = [game(1, { match_state: 'GameEnd', round: 10, scores: [7, 3], results: [result] })];
    await w.pollNow();
    await w.pollNow();
    expect(events).toEqual(['state null->WaitingForPlayers', 'state WaitingForPlayers->OnGoing', 'score 2 1-0', 'state OnGoing->GameEnd', 'score 10 7-3', 'result 0 7-3']);
  });

  it('skips results already handled when resuming', async () => {
    const w = setup().track(1, { seenResults: 1 });
    const results: number[] = [];
    w.on('matchResult', (_g, _r, i) => results.push(i));
    const r = { match_id: null, map_id: 613, team_factions: [], winning_team: 0, win_condition: 'x', scores: [], started_at: 0, ended_at: 0, map_variation: 0, rounds_played: 0, players: [] };
    current = [game(1, { results: [r, r] })];
    await w.pollNow();
    expect(results).toEqual([1]);
  });

  it('reports refused games, ends and untracks them', async () => {
    const w = setup().track(1);
    const events: string[] = [];
    w.on('rejected', (_g, reason) => events.push(`rejected ${reason}`));
    w.on('ended', () => events.push('ended'));
    current = [game(1, { status: 'ended', room: { ...game(1).room, id: -1, code: null }, rejection_reason: 'ServerFull' })];
    await w.pollNow();
    expect(events).toEqual(['rejected ServerFull', 'ended']);
    expect(w.size).toBe(0);
  });

  it('declares a game gone only after the grace period', async () => {
    vi.useFakeTimers();
    const w = setup().track(1);
    const gone: number[] = [];
    w.on('gone', (id) => gone.push(id));
    await w.pollNow();
    expect(gone).toEqual([]);
    vi.advanceTimersByTime(11_000);
    await w.pollNow();
    expect(gone).toEqual([1]);
    expect(w.size).toBe(0);
  });

  it('reports poll failures without crashing', async () => {
    const w = setup().track(1);
    const errors: unknown[] = [];
    w.on('pollError', (e) => errors.push(e));
    fail = 'error';
    await w.pollNow();
    expect(errors).toHaveLength(1);
  });

  it('stops by itself when the token cannot host games', async () => {
    const w = setup().track(1);
    const errors: unknown[] = [];
    w.on('pollError', (e) => errors.push(e));
    w.start();
    fail = 'denied';
    await w.pollNow();
    await w.stop();
    expect(w.isRunning).toBe(false);
    expect(errors).toEqual([expect.objectContaining({ code: 'insufficient_permissions' })]);
  });

  it('polls on an interval once started, and stops', async () => {
    vi.useFakeTimers();
    const w = setup({ intervalMs: 5000 }).track(1);
    let updates = 0;
    w.on('update', () => updates++);
    current = [game(1)];
    w.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await w.stop();
    const after = updates;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(after).toBe(3);
    expect(updates).toBe(3);
  });
});
