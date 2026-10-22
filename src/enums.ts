type ValueOf<T> = T[keyof T];
type Open<T extends string> = T | (string & {});

export const UserType = {
  Spectator: 0,
  User: 1,
  AssistantMod: 2,
  Moderator: 4,
  VeteranMod: 8,
  Developer: 64,
} as const;
export type UserType = ValueOf<typeof UserType>;

export const BanType = {
  Permanent: 0,
  Temporary: 1,
} as const;
export type BanType = ValueOf<typeof BanType>;

export const BanReason = {
  Unknown: 0,
  FraudAttempt: 1,
  Hacking: 2,
  Griefing: 3,
  VerbalAbuse: 4,
  Idle: 5,
  Spam: 6,
  ReportAbuse: 7,
  AccountTrading: 8,
  Glitching: 9,
  Ghosting: 10,
  PartyingWithHacker: 11,
  UnderInvestigation: 12,
  MarketplaceAbuse: 13,
} as const;
export type BanReason = ValueOf<typeof BanReason>;
export type BanReasonCode = BanReason;

export const ClanMemberRank = {
  Member: 10,
  Officer: 20,
  CoLeader: 30,
  Leader: 40,
} as const;
export type ClanMemberRank = ValueOf<typeof ClanMemberRank>;

export const PartyInvitePermission = {
  Anybody: 0,
  OnlyFriendsAndClanMembers: 1,
  Nobody: 2,
} as const;
export type PartyInvitePermission = ValueOf<typeof PartyInvitePermission>;

export const GameType = {
  Ranked: 1,
  Casual: 2,
} as const;
export type GameType = ValueOf<typeof GameType>;
export type GameTypeCode = GameType;

export const MatchResult = {
  Win: 1,
  Loss: 2,
  Draw: 3,
} as const;
export type MatchResult = ValueOf<typeof MatchResult>;
export type MatchResultCode = MatchResult;

export const AccountAge = {
  UnderAWeek: '1w',
  UnderAMonth: '1m',
  UnderThreeMonths: '3m',
  UnderAYear: '1y',
  UnderTwoYears: '2y',
  UnderThreeYears: '3y',
  UnderFourYears: '4y',
  FourYearsOrMore: '5y+',
} as const;
export type AccountAge = ValueOf<typeof AccountAge>;

export const InputDeviceFlag = {
  KeyboardMouse: 1,
  Touch: 2,
  Gamepad: 4,
} as const;
export type InputDeviceFlag = ValueOf<typeof InputDeviceFlag>;

export function hasInputDevice(flags: number, device: InputDeviceFlag): boolean {
  return (flags & device) !== 0;
}

export const MapId = {
  Canals: 613,
  Plaza: 615,
  Legacy: 617,
  Grounded: 618,
  Bureau: 619,
  Brewery: 839,
  Division: 841,
  Uplink: 1311,
  Yard: 1312,
  Raid: 1360,
  Heat: 4483,
  Warehouse: 6655,
  Gallery: 6670,
  Port: 6677,
  Park: 7201,
  Purify: 7316,
  Cargo: 7554,
  Arctic: 7584,
  Bout: 8024,
  Soar: 8427,
  Shanty: 8872,
  Hangar: 9310,
  Village: 13410,
  Impasse: 14066,
  Overhaul: 15028,
  Castello: 15391,
} as const;
export type MapId = ValueOf<typeof MapId>;

export const GameModeId = {
  Defuse: 15773,
  Elimination: 15775,
  Gungame: 15776,
  TeamDeathmatch: 15777,
  Manhunt: 15846,
  TournamentMode: 15847,
  Rush: 15860,
  Defend: 15861,
  ManhuntZ: 18596,
  Wingman: 18850,
} as const;
export type GameModeId = ValueOf<typeof GameModeId>;

export const WinCondition = {
  TeamEliminated: 'TeamEliminated',
  TeamKills: 'TeamKills',
  TimeUp: 'TimeUp',
  Surrendered: 'Surrendered',
} as const;
export type WinCondition = Open<ValueOf<typeof WinCondition>>;

export const LeaveReason = {
  Left: 'Left',
  Timeout: 'Timeout',
  Kicked: 'Kicked',
  Banned: 'Banned',
  PingLimit: 'PingLimit',
  AFK: 'AFK',
} as const;
export type LeaveReason = Open<ValueOf<typeof LeaveReason>>;

export const MatchState = {
  WaitingForPlayers: 'WaitingForPlayers',
  Starting: 'Starting',
  Freezetime: 'Freezetime',
  OnGoing: 'OnGoing',
  BombPlanted: 'BombPlanted',
  Win: 'Win',
  TeamFlip: 'TeamFlip',
  GameEnd: 'GameEnd',
  ChangingMap: 'ChangingMap',
} as const;
export type MatchState = Open<ValueOf<typeof MatchState>>;

export const AutohostCommand = {
  Kick: 'kick',
  Restart: 'restart',
  RoomOwnerAdd: 'room_owner_add',
  RoomOwnerRemove: 'room_owner_remove',
  Close: 'close',
} as const;
export type AutohostCommand = ValueOf<typeof AutohostCommand>;

export const LeaderboardType = {
  Mmr: 'mmr',
  Kills: 'kills',
  Deaths: 'deaths',
  Assists: 'assists',
  Matches: 'matches',
  Wins: 'wins',
  Losses: 'losses',
  Xp: 'xp',
  Mvp: 'mvp',
} as const;
export type LeaderboardType = ValueOf<typeof LeaderboardType>;

export const GameStatus = {
  Open: 'open',
  Ended: 'ended',
} as const;
export type GameStatus = ValueOf<typeof GameStatus>;
