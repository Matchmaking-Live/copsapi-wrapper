import { describe, expect, it } from 'vitest';
import {
  careerTotals,
  describeBan,
  gameMode,
  inputDevices,
  isHostable,
  kd,
  mapId,
  mapName,
  modesFor,
  randomPassword,
  regionOf,
  seasonTotals,
  summarizeResult,
} from '../src/index.js';
import { player, profile } from './helpers.js';

describe('catalog', () => {
  it('resolves maps by name, id or numeric string', () => {
    expect(mapId('Castello')).toBe(15391);
    expect(mapId(' canals ')).toBe(613);
    expect(mapId('613')).toBe(613);
    expect(mapId(1)).toBeNull();
    expect(mapName(8427)).toBe('Soar');
  });

  it('resolves game modes by key, name or id', () => {
    expect(gameMode('tournament')?.id).toBe(15847);
    expect(gameMode('Team Deathmatch')?.key).toBe('tdm');
    expect(gameMode('manhunt z')?.id).toBe(18596);
    expect(gameMode(15777)?.name).toBe('Team Deathmatch');
    expect(gameMode('nope')).toBeNull();
  });

  it('knows which maps each mode can be hosted on', () => {
    expect(isHostable('tournament', 'Castello')).toBe(true);
    expect(isHostable('tournament', 'Heat')).toBe(false);
    expect(isHostable('wingman', 'Grounded')).toBe(false);
    expect(modesFor('Purify').map((m) => m.key)).toEqual(['defuse', 'tdm', 'manhunt', 'rush', 'manhuntz']);
  });
});

describe('helpers', () => {
  it('decodes input device flags', () => {
    expect(inputDevices(1)).toEqual(['keyboard_mouse']);
    expect(inputDevices(6)).toEqual(['touch', 'gamepad']);
  });

  it('describes bans', () => {
    expect(describeBan(null)).toBeNull();
    expect(describeBan({ type: 0, reason: 2, days_left: 0 })).toBe('Permanently banned (Hacking)');
    expect(describeBan({ type: 1, reason: 4, days_left: 1 })).toBe('Banned for 1 more day (Verbal abuse)');
  });

  it('totals career and season stats', () => {
    const p = profile(1);
    expect(careerTotals(p, 'ranked')).toMatchObject({ kills: 30, deaths: 15, kd: 2, wins: 5, losses: 3, matches: 8, winRate: 0.625 });
    expect(seasonTotals(p, undefined, 'ranked')).toMatchObject({ kills: 20, wins: 2 });
    expect(seasonTotals(p, 7)).toBeNull();
    expect(kd(5, 0)).toBe(5);
  });

  it('summarises a result by team with the top fragger and leavers', () => {
    const s = summarizeResult({
      match_id: 'm', map_id: 613, team_factions: [1, 0], winning_team: 1, win_condition: 'TeamKills', scores: [5, 7],
      started_at: 100, ended_at: 1300, map_variation: 0, rounds_played: 12,
      players: [player(1, { team: 0, kills: 9 }), player(2, { team: 1, kills: 20 }), player(3, { team: 1, kills: 4, left_match: true, leave_reason: 'Left' }), player(4, { team: -1, kills: 50 })],
    });
    expect(s).toMatchObject({ map: 'Canals', winningTeam: 1, draw: false, durationSec: 1200 });
    expect(s.teams.map((t) => [t.team, t.score, t.won, t.players.map((p) => p.user_id)])).toEqual([[0, 5, false, [1]], [1, 7, true, [2, 3]]]);
    expect(s.topFragger?.user_id).toBe(2);
    expect(s.leavers.map((p) => p.user_id)).toEqual([3]);
  });

  it('makes unambiguous room passwords', () => {
    const pw = randomPassword(10);
    expect(pw).toHaveLength(10);
    expect(pw).not.toMatch(/[01IO]/);
  });

  it('guesses regions from server names', () => {
    expect(regionOf('Europe/DE-1')).toBe('EU');
    expect(regionOf('NA-East')).toBe('NA');
    expect(regionOf('Singapore')).toBe('AS');
    expect(regionOf('Mars-1')).toBeNull();
  });
});
