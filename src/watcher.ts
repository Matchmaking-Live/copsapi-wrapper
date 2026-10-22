import { EventEmitter } from 'node:events';
import type { CopsClient } from './client.js';
import { isCopsError } from './errors.js';
import type { MatchState } from './enums.js';
import type { AutohostGame, AutohostResult, PlayerMatchStats } from './types.js';

export interface WatcherOptions {
  intervalMs?: number;
  missingGraceMs?: number;
  untrackEnded?: boolean;
}

export interface TrackOptions {
  seenResults?: number;
  meta?: unknown;
}

export interface JoinInfo {
  firstSeenAt: number;
  sinceRoomReadyMs: number | null;
}

export interface WatcherEvents {
  update: [game: AutohostGame, previous: AutohostGame | null];
  roomReady: [game: AutohostGame];
  rejected: [game: AutohostGame, reason: string | null];
  state: [game: AutohostGame, state: MatchState, previous: MatchState | null];
  matchStart: [game: AutohostGame];
  score: [game: AutohostGame, round: number, scores: number[]];
  playerJoin: [game: AutohostGame, player: PlayerMatchStats, join: JoinInfo];
  playerLeave: [game: AutohostGame, player: PlayerMatchStats];
  playerDisconnect: [game: AutohostGame, player: PlayerMatchStats];
  playerReconnect: [game: AutohostGame, player: PlayerMatchStats, offlineMs: number];
  playerTeamChange: [game: AutohostGame, player: PlayerMatchStats, previousTeam: number];
  matchResult: [game: AutohostGame, result: AutohostResult, index: number];
  ended: [game: AutohostGame];
  gone: [id: number, lastKnown: AutohostGame | null];
  pollError: [error: unknown];
}

interface Tracked {
  id: number;
  meta: unknown;
  game: AutohostGame | null;
  addedAt: number;
  lastSeenAt: number | null;
  roomReadyAt: number | null;
  seenResults: number;
  joins: Map<number, JoinInfo>;
  offlineSince: Map<number, number>;
}

const sameScores = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export class AutohostWatcher extends EventEmitter<WatcherEvents> {
  private readonly games = new Map<number, Tracked>();
  private readonly intervalMs: number;
  private readonly missingGraceMs: number;
  private readonly untrackEnded: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private active = false;

  constructor(private readonly client: CopsClient, opts: WatcherOptions = {}) {
    super();
    this.intervalMs = Math.max(1000, opts.intervalMs ?? 5000);
    this.missingGraceMs = opts.missingGraceMs ?? 60_000;
    this.untrackEnded = opts.untrackEnded ?? true;
  }

  track(game: number | AutohostGame, opts: TrackOptions = {}): this {
    const id = typeof game === 'number' ? game : game.id;
    if (!this.games.has(id)) {
      this.games.set(id, {
        id,
        meta: opts.meta,
        game: null,
        addedAt: Date.now(),
        lastSeenAt: null,
        roomReadyAt: null,
        seenResults: opts.seenResults ?? 0,
        joins: new Map(),
        offlineSince: new Map(),
      });
    }
    return this;
  }

  untrack(id: number): boolean {
    return this.games.delete(id);
  }

  get ids(): number[] {
    return [...this.games.keys()];
  }

  get size(): number {
    return this.games.size;
  }

  latest(id: number): AutohostGame | null {
    return this.games.get(id)?.game ?? null;
  }

  meta<T = unknown>(id: number): T | undefined {
    return this.games.get(id)?.meta as T | undefined;
  }

  joinTimes(id: number): Map<number, JoinInfo> {
    return new Map(this.games.get(id)?.joins ?? []);
  }

  roomReadyAt(id: number): number | null {
    return this.games.get(id)?.roomReadyAt ?? null;
  }

  get isRunning(): boolean {
    return this.active;
  }

  start(): this {
    if (this.active) return this;
    this.active = true;
    this.schedule(0);
    return this;
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  async pollNow(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tick().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private schedule(delay: number) {
    if (!this.active) return;
    this.timer = setTimeout(async () => {
      const started = Date.now();
      await this.pollNow();
      this.schedule(Math.max(0, this.intervalMs - (Date.now() - started)));
    }, delay);
  }

  private async tick(): Promise<void> {
    const ids = this.ids;
    if (!ids.length) return;
    let games: AutohostGame[];
    try {
      games = await this.client.autohost.poll(ids);
    } catch (err) {
      this.emit('pollError', err);
      if (isCopsError(err, 'insufficient_permissions', 'invalid_token', 'token_revoked')) void this.stop();
      return;
    }
    const now = Date.now();
    const returned = new Set<number>();
    for (const game of games) {
      const tracked = this.games.get(game.id);
      if (!tracked) continue;
      returned.add(game.id);
      tracked.lastSeenAt = now;
      this.diff(tracked, game, now);
    }
    for (const id of ids) {
      if (returned.has(id)) continue;
      const tracked = this.games.get(id);
      if (!tracked) continue;
      if (now - (tracked.lastSeenAt ?? tracked.addedAt) >= this.missingGraceMs) {
        this.games.delete(id);
        this.emit('gone', id, tracked.game);
      }
    }
  }

  private diff(t: Tracked, next: AutohostGame, now: number) {
    const prev = t.game;
    t.game = next;
    this.emit('update', next, prev);

    if (!prev?.room.code && next.room.code) {
      t.roomReadyAt = now;
      this.emit('roomReady', next);
    }

    if (next.match_state != null && next.match_state !== (prev?.match_state ?? null)) {
      this.emit('state', next, next.match_state, prev?.match_state ?? null);
    }

    if (next.match_started_at != null && next.match_started_at !== (prev?.match_started_at ?? null)) {
      this.emit('matchStart', next);
    }

    if (prev && next.status === 'open' && next.scores.length && (next.round !== prev.round || !sameScores(next.scores, prev.scores))) {
      this.emit('score', next, next.round, next.scores);
    }

    if (next.status === 'open') this.diffPlayers(t, prev, next, now);

    for (let i = t.seenResults; i < next.results.length; i++) {
      const result = next.results[i];
      if (result) this.emit('matchResult', next, result, i);
    }
    t.seenResults = Math.max(t.seenResults, next.results.length);

    if (next.status === 'ended' && prev?.status !== 'ended') {
      if (next.room.id === -1 || (!t.roomReadyAt && !next.results.length && next.rejection_reason)) this.emit('rejected', next, next.rejection_reason);
      this.emit('ended', next);
      if (this.untrackEnded) this.games.delete(t.id);
    }
  }

  private diffPlayers(t: Tracked, prev: AutohostGame | null, next: AutohostGame, now: number) {
    const before = new Map((prev?.players ?? []).map((p) => [p.user_id, p]));
    const after = new Map(next.players.map((p) => [p.user_id, p]));
    for (const [userId, player] of after) {
      const old = before.get(userId);
      if (!old) {
        if (!t.joins.has(userId)) t.joins.set(userId, { firstSeenAt: now, sinceRoomReadyMs: t.roomReadyAt != null ? now - t.roomReadyAt : null });
        this.emit('playerJoin', next, player, t.joins.get(userId) as JoinInfo);
        if (player.ping < 0) t.offlineSince.set(userId, now);
        continue;
      }
      if (old.ping >= 0 && player.ping < 0) {
        t.offlineSince.set(userId, now);
        this.emit('playerDisconnect', next, player);
      } else if (old.ping < 0 && player.ping >= 0) {
        const since = t.offlineSince.get(userId);
        t.offlineSince.delete(userId);
        this.emit('playerReconnect', next, player, since != null ? now - since : 0);
      }
      if (old.team !== player.team) this.emit('playerTeamChange', next, player, old.team);
    }
    for (const [userId, player] of before) {
      if (after.has(userId)) continue;
      t.offlineSince.delete(userId);
      this.emit('playerLeave', next, player);
    }
  }
}
