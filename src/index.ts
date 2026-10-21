export { CopsClient, VERSION, DEFAULT_BASE_URL, TOKEN_PATTERN } from './client.js';
export type {
  CopsClientOptions,
  CallOptions,
  GameServer,
  LeaderboardPage,
  HostOptions,
  HostAndWaitOptions,
  HostedRoom,
  WaitForRoomOptions,
  TokenCheck,
  ProfilesApi,
  ServersApi,
  MatchesApi,
  StatsApi,
  LeaderboardsApi,
  AutohostApi,
} from './client.js';
export { AutohostWatcher } from './watcher.js';
export type { WatcherOptions, WatcherEvents, TrackOptions, JoinInfo } from './watcher.js';
export { CopsApiError, isCopsError } from './errors.js';
export type { CopsErrorCode, ApiErrorCode, ClientErrorCode, CopsApiErrorDetails } from './errors.js';
export { MemoryCache, DEFAULT_TTLS } from './cache.js';
export type { CacheStore, CacheTtls } from './cache.js';
export type { RateLimitOptions, QuotaSnapshot, Priority } from './ratelimit.js';
export type { Hooks, RequestInfo, ResponseInfo, RetryInfo } from './transport.js';
export {
  MAPS,
  GAME_MODES,
  BAN_REASONS,
  USER_TYPES,
  ACCOUNT_AGES,
  PARTY_INVITE_PERMISSIONS,
  CLAN_RANKS,
  GAME_TYPES,
  LEADERBOARD_TYPES,
  MATCH_STATES,
  INPUT_DEVICES,
  mapId,
  mapName,
  gameMode,
  mapsFor,
  modesFor,
  isHostable,
} from './catalog.js';
export type { MapId, MapName, GameModeKey, GameModeInfo, GameTypeName, InputDevice } from './catalog.js';
export {
  inputDevices,
  banReason,
  describeBan,
  accountAgeLabel,
  isNewAccount,
  isStaff,
  kd,
  careerTotals,
  seasonTotals,
  summarizeResult,
  randomPassword,
  regionOf,
} from './util.js';
export type { Totals, TotalsScope, TeamSummary, ResultSummary, Region } from './util.js';
export type * from './types.js';
