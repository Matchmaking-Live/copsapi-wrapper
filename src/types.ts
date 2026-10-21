export type UnixSeconds = number;

export type UserType = 0 | 1 | 2 | 4 | 8 | 64;
export type BanType = 0 | 1;
export type BanReasonCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type AccountAge = '1w' | '1m' | '3m' | '1y' | '2y' | '3y' | '4y' | '5y+';
export type PartyInvitePermission = 0 | 1 | 2;
export type ClanMemberRank = 10 | 20 | 30 | 40;
export type GameTypeCode = 1 | 2;
export type MatchResultCode = 1 | 2 | 3;

export interface PlayerLevel {
  level: number;
  current_xp: number;
  next_level_xp: number;
}

export interface ProfileBasicInfo {
  user_id: number;
  name: string;
  user_type: UserType;
  icon_id: number;
  player_level: PlayerLevel;
  last_seen_time: string;
}

export interface Ban {
  type: BanType;
  reason: BanReasonCode;
  days_left: number;
}

export interface ClanBasicInfo {
  id: number;
  name: string;
  tag: string;
  emblem_id: number;
}

export interface ClanMembership {
  basic_info: ClanBasicInfo;
  member_rank: ClanMemberRank;
  joined: string;
}

export interface MatchStats {
  k: number;
  d: number;
  a: number;
  w: number;
  l: number;
}

export interface SeasonStats {
  season: number;
  ranked: MatchStats;
  casual: MatchStats;
  custom: MatchStats;
}

export interface RankedStats {
  placement_matches_left: number;
  wins: number;
  losses: number;
  highest_rank: number;
  mmr: number;
  global_position: number;
  rank: number;
}

export interface LeaderboardPosition {
  position: number;
  score: number;
}

export interface ProfileStats {
  seasonal_stats: SeasonStats[];
  ranked: RankedStats;
  leaderboard_data: LeaderboardPosition;
}

export interface Profile {
  basic_info: ProfileBasicInfo;
  account_age: AccountAge;
  blocked_friend_requests: boolean;
  blocked_clan_requests: boolean;
  party_invite_permissions: PartyInvitePermission;
  ban: Ban | null;
  stats: ProfileStats;
  clan?: ClanMembership;
}

export interface ServerStatus {
  name: string;
  status: 'online' | 'offline';
}

export interface MatchHistoryEntry {
  id: string;
  game_type: GameTypeCode;
  game_mode_id: number;
  map_id: number;
  team: number;
  result: MatchResultCode;
  left_match: boolean;
  scores: number[];
}

export interface PartyInfo {
  is_leader: boolean;
  players: number[];
}

export type LeaveReason = 'Left' | 'Timeout' | 'Kicked' | 'Banned' | 'PingLimit' | 'AFK' | (string & {});

export interface MatchPlayer {
  user_id: number;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage_dealt: number;
  input_device_flags: number;
  left_match: boolean;
  leave_reason: LeaveReason | null;
  level: number;
  match_presence: number;
  party_info: PartyInfo | null;
}

export interface MatchInfo {
  id: string;
  game_type: GameTypeCode;
  game_mode_id: number;
  server_id: number;
  map_id: number;
  team_factions: number[];
  winning_team: number;
  win_condition: 'TeamEliminated' | 'TeamKills' | 'TimeUp' | 'Surrendered' | (string & {});
  scores: number[];
  started_at: UnixSeconds;
  ended_at: UnixSeconds;
  players: MatchPlayer[];
  replay_id: string | null;
}

export interface WeaponStats {
  weapon_id: number;
  name: string;
  k: number;
  a: number;
  h: number;
}

export type LeaderboardType = 'mmr' | 'kills' | 'deaths' | 'assists' | 'matches' | 'wins' | 'losses' | 'xp' | 'mvp';

export interface LeaderboardEntry {
  position: number;
  score: number;
  basic_info: ProfileBasicInfo;
  ranked: RankedStats;
  clan?: ClanMembership;
}

export type MatchState =
  | 'WaitingForPlayers'
  | 'Starting'
  | 'Freezetime'
  | 'OnGoing'
  | 'BombPlanted'
  | 'Win'
  | 'TeamFlip'
  | 'GameEnd'
  | 'ChangingMap'
  | (string & {});

export interface PlayerMatchStats {
  user_id: number;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage_dealt: number;
  input_device_flags: number;
  left_match: boolean;
  leave_reason: LeaveReason | null;
  ping: number;
  user_type: UserType;
  is_owner: boolean;
}

export interface AutohostRoom {
  id: number;
  code: string | null;
  name: string;
  map_id: number;
  game_mode_id: number;
  has_password: boolean;
}

export interface AutohostResult {
  match_id: string | null;
  map_id: number;
  team_factions: number[];
  winning_team: number;
  win_condition: string;
  scores: number[];
  started_at: UnixSeconds;
  ended_at: UnixSeconds;
  map_variation: number;
  rounds_played: number;
  players: PlayerMatchStats[];
}

export interface AutohostGame {
  id: number;
  status: 'open' | 'ended';
  created_at: UnixSeconds;
  updated_at: UnixSeconds;
  ended_at: UnixSeconds | null;
  pending_expires_at: UnixSeconds | null;
  server_id: number;
  room: AutohostRoom;
  player_count: number;
  match_started_at: UnixSeconds | null;
  match_state: MatchState | null;
  round: number;
  scores: number[];
  players: PlayerMatchStats[];
  results: AutohostResult[];
  replay_id: string | null;
  rejection_reason: string | null;
}

export type AutohostCommand = 'kick' | 'restart' | 'room_owner_add' | 'room_owner_remove' | 'close';

export interface ApiErrorBody {
  error: { code: string; message: string; retry_after?: number };
}
