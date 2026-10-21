import { randomInt } from 'node:crypto';
import { ACCOUNT_AGES, BAN_REASONS, INPUT_DEVICES, mapName, type InputDevice } from './catalog.js';
import type { AutohostResult, Ban, MatchInfo, MatchPlayer, PlayerMatchStats, Profile, UserType } from './types.js';

export function inputDevices(flags: number): InputDevice[] {
  return (Object.entries(INPUT_DEVICES) as [InputDevice, number][]).filter(([, bit]) => (flags & bit) !== 0).map(([name]) => name);
}

export function banReason(ban: Ban | null | undefined): string | null {
  return ban ? BAN_REASONS[ban.reason] ?? `Reason ${ban.reason}` : null;
}

export function describeBan(ban: Ban | null | undefined): string | null {
  if (!ban) return null;
  const reason = banReason(ban);
  if (ban.type === 0) return `Permanently banned (${reason})`;
  if (ban.days_left === 0) return `Banned with no end date (${reason})`;
  return `Banned for ${ban.days_left} more day${ban.days_left === 1 ? '' : 's'} (${reason})`;
}

export function accountAgeLabel(profile: Pick<Profile, 'account_age'>): string {
  return ACCOUNT_AGES[profile.account_age] ?? profile.account_age;
}

export function isNewAccount(profile: Pick<Profile, 'account_age'>): boolean {
  return profile.account_age === '1w' || profile.account_age === '1m';
}

export function isStaff(userType: UserType | number): boolean {
  return userType >= 2;
}

export function kd(kills: number, deaths: number, digits = 2): number {
  const ratio = deaths === 0 ? kills : kills / deaths;
  const f = 10 ** digits;
  return Math.round(ratio * f) / f;
}

export interface Totals {
  kills: number;
  deaths: number;
  assists: number;
  wins: number;
  losses: number;
  matches: number;
  kd: number;
  winRate: number;
}

export type TotalsScope = 'ranked' | 'casual' | 'custom' | 'all';

function totals(rows: { k: number; d: number; a: number; w: number; l: number }[]): Totals {
  const sum = rows.reduce((acc, r) => ({ k: acc.k + r.k, d: acc.d + r.d, a: acc.a + r.a, w: acc.w + r.w, l: acc.l + r.l }), { k: 0, d: 0, a: 0, w: 0, l: 0 });
  const matches = sum.w + sum.l;
  return { kills: sum.k, deaths: sum.d, assists: sum.a, wins: sum.w, losses: sum.l, matches, kd: kd(sum.k, sum.d), winRate: matches ? Math.round((sum.w / matches) * 1000) / 1000 : 0 };
}

export function careerTotals(profile: Pick<Profile, 'stats'>, scope: TotalsScope = 'all'): Totals {
  const seasons = profile.stats.seasonal_stats ?? [];
  const pick = scope === 'all' ? (['ranked', 'casual', 'custom'] as const) : ([scope] as const);
  return totals(seasons.flatMap((s) => pick.map((k) => s[k])));
}

export function seasonTotals(profile: Pick<Profile, 'stats'>, season?: number, scope: TotalsScope = 'all'): Totals | null {
  const seasons = profile.stats.seasonal_stats ?? [];
  const entry = season === undefined ? seasons[seasons.length - 1] : seasons.find((s) => s.season === season);
  if (!entry) return null;
  const pick = scope === 'all' ? (['ranked', 'casual', 'custom'] as const) : ([scope] as const);
  return totals(pick.map((k) => entry[k]));
}

type AnyPlayer = PlayerMatchStats | MatchPlayer;

export interface TeamSummary<P extends AnyPlayer> {
  team: number;
  score: number;
  faction: number | null;
  won: boolean;
  players: P[];
}

export interface ResultSummary<P extends AnyPlayer> {
  map: string | null;
  winningTeam: number | null;
  draw: boolean;
  winCondition: string;
  durationSec: number;
  teams: TeamSummary<P>[];
  topFragger: P | null;
  leavers: P[];
}

export function summarizeResult<R extends AutohostResult | MatchInfo>(result: R): ResultSummary<R['players'][number]> {
  type P = R['players'][number];
  const players = result.players as P[];
  const winner = result.winning_team >= 0 ? result.winning_team : null;
  const teamCount = Math.max(result.scores.length, ...players.map((p) => p.team + 1), 0);
  const byKills = (a: P, b: P) => b.kills - a.kills || a.deaths - b.deaths || b.damage_dealt - a.damage_dealt;
  const teams: TeamSummary<P>[] = [];
  for (let team = 0; team < teamCount; team++) {
    teams.push({
      team,
      score: result.scores[team] ?? 0,
      faction: result.team_factions[team] ?? null,
      won: winner === team,
      players: players.filter((p) => p.team === team).sort(byKills),
    });
  }
  const ranked = [...players].filter((p) => p.team >= 0).sort(byKills);
  return {
    map: mapName(result.map_id),
    winningTeam: winner,
    draw: winner === null,
    winCondition: result.win_condition,
    durationSec: Math.max(0, result.ended_at - result.started_at),
    teams,
    topFragger: ranked[0] ?? null,
    leavers: players.filter((p) => p.left_match),
  };
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomPassword(length = 6, alphabet = PASSWORD_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export type Region = 'EU' | 'NA' | 'SA' | 'AS' | 'OC' | 'ME' | 'AF';

const REGION_PATTERNS: [Region, RegExp][] = [
  ['EU', /^(eu\b|eu-|europe|de-|frankfurt|amsterdam|london|paris|stockholm|warsaw|madrid|finland|helsinki)/i],
  ['NA', /^(na\b|na-|us\b|us-|usa|north america|america|new york|chicago|dallas|seattle|los angeles|virginia|oregon|canada)/i],
  ['SA', /^(sa\b|sa-|br\b|br-|brazil|south america|sao paulo|são paulo|santiago|buenos aires)/i],
  ['AS', /^(as\b|as-|asia|sg\b|sg-|singapore|jp\b|jp-|japan|tokyo|hk\b|hong kong|kr\b|seoul|in\b|india|mumbai|sea\b)/i],
  ['OC', /^(oc\b|oc-|oceania|au\b|au-|australia|sydney)/i],
  ['ME', /^(me\b|me-|middle east|dubai|bahrain)/i],
  ['AF', /^(af\b|af-|africa|johannesburg)/i],
];

export function regionOf(serverName: string): Region | null {
  const name = serverName.trim();
  for (const [region, pattern] of REGION_PATTERNS) if (pattern.test(name)) return region;
  return null;
}
