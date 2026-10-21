import type { AccountAge, BanReasonCode, ClanMemberRank, PartyInvitePermission, UserType } from './types.js';

export const MAPS = {
  613: 'Canals',
  615: 'Plaza',
  617: 'Legacy',
  618: 'Grounded',
  619: 'Bureau',
  839: 'Brewery',
  841: 'Division',
  1311: 'Uplink',
  1312: 'Yard',
  1360: 'Raid',
  4483: 'Heat',
  6655: 'Warehouse',
  6670: 'Gallery',
  6677: 'Port',
  7201: 'Park',
  7316: 'Purify',
  7554: 'Cargo',
  7584: 'Arctic',
  8024: 'Bout',
  8427: 'Soar',
  8872: 'Shanty',
  9310: 'Hangar',
  13410: 'Village',
  14066: 'Impasse',
  15028: 'Overhaul',
  15391: 'Castello',
} as const satisfies Record<number, string>;

export type MapId = keyof typeof MAPS;
export type MapName = (typeof MAPS)[MapId];

export interface GameModeInfo {
  readonly id: number;
  readonly key: GameModeKey;
  readonly name: string;
  readonly maps: readonly MapId[];
}

const ALL_TDM_MAPS = [613, 615, 617, 618, 619, 839, 841, 1311, 1312, 1360, 4483, 6655, 6670, 6677, 7201, 7316, 7554, 7584, 8024, 8427, 8872, 9310, 13410, 14066, 15028, 15391] as const;

export const GAME_MODES = {
  defuse: { id: 15773, key: 'defuse', name: 'Defuse', maps: [613, 615, 617, 618, 619, 1311, 1312, 1360, 6677, 7201, 7316, 7584, 8024, 8427, 8872, 13410, 15391] },
  elimination: { id: 15775, key: 'elimination', name: 'Elimination', maps: [6655, 14066, 15028] },
  gungame: { id: 15776, key: 'gungame', name: 'Gungame', maps: [839, 841, 1311, 1312, 4483, 6655, 6670, 7201, 7554, 7584, 8024, 9310, 14066, 15028] },
  tdm: { id: 15777, key: 'tdm', name: 'Team Deathmatch', maps: ALL_TDM_MAPS },
  manhunt: { id: 15846, key: 'manhunt', name: 'Manhunt', maps: [7316] },
  tournament: { id: 15847, key: 'tournament', name: 'Tournament Mode', maps: [613, 615, 617, 618, 619, 1360, 6677, 8427, 13410, 15391] },
  rush: { id: 15860, key: 'rush', name: 'Rush', maps: ALL_TDM_MAPS },
  defend: { id: 15861, key: 'defend', name: 'Defend', maps: [8872] },
  manhuntz: { id: 18596, key: 'manhuntz', name: 'Manhunt Z', maps: [7316] },
  wingman: { id: 18850, key: 'wingman', name: 'Wingman', maps: [613, 615, 617, 619, 1360, 13410, 15391] },
} as const satisfies Record<string, { id: number; key: string; name: string; maps: readonly MapId[] }>;

export type GameModeKey = keyof typeof GAME_MODES;

const MODE_BY_ID = new Map<number, GameModeInfo>(Object.values(GAME_MODES).map((m) => [m.id, m as GameModeInfo]));
const MAP_BY_NAME = new Map<string, MapId>(Object.entries(MAPS).map(([id, name]) => [name.toLowerCase(), Number(id) as MapId]));

export function mapId(map: number | string): MapId | null {
  if (typeof map === 'number') return map in MAPS ? (map as MapId) : null;
  const trimmed = map.trim();
  if (/^\d+$/.test(trimmed)) return mapId(Number(trimmed));
  return MAP_BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

export function mapName(id: number): MapName | null {
  return MAPS[id as MapId] ?? null;
}

export function gameMode(mode: number | string): GameModeInfo | null {
  if (typeof mode === 'number') return MODE_BY_ID.get(mode) ?? null;
  const key = mode.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (/^\d+$/.test(key)) return gameMode(Number(key));
  for (const m of Object.values(GAME_MODES) as GameModeInfo[]) {
    if (m.key === key || m.name.toLowerCase().replace(/[\s_-]+/g, '') === key) return m;
  }
  if (key === 'teamdeathmatch') return GAME_MODES.tdm;
  if (key === 'tournamentmode') return GAME_MODES.tournament;
  return null;
}

export function mapsFor(mode: number | string): MapId[] {
  return [...(gameMode(mode)?.maps ?? [])];
}

export function modesFor(map: number | string): GameModeInfo[] {
  const id = mapId(map);
  if (id == null) return [];
  return (Object.values(GAME_MODES) as GameModeInfo[]).filter((m) => m.maps.includes(id));
}

export function isHostable(mode: number | string, map: number | string): boolean {
  const m = gameMode(mode);
  const id = mapId(map);
  return !!m && id != null && m.maps.includes(id);
}

export const BAN_REASONS: Record<BanReasonCode, string> = {
  0: 'Unknown',
  1: 'Fraud attempt',
  2: 'Hacking',
  3: 'Griefing',
  4: 'Verbal abuse',
  5: 'Idle',
  6: 'Spam',
  7: 'Report abuse',
  8: 'Account trading',
  9: 'Glitching',
  10: 'Ghosting',
  11: 'Partying with hacker',
  12: 'Under investigation',
  13: 'Marketplace abuse',
};

export const USER_TYPES: Record<UserType, string> = {
  0: 'Spectator',
  1: 'User',
  2: 'Assistant mod',
  4: 'Moderator',
  8: 'Veteran mod',
  64: 'Developer',
};

export const ACCOUNT_AGES: Record<AccountAge, string> = {
  '1w': 'Under a week',
  '1m': 'Under a month',
  '3m': 'Under 3 months',
  '1y': 'Under a year',
  '2y': '1 to 2 years',
  '3y': '2 to 3 years',
  '4y': '3 to 4 years',
  '5y+': '4 years or more',
};

export const PARTY_INVITE_PERMISSIONS: Record<PartyInvitePermission, string> = {
  0: 'Anybody',
  1: 'Only friends and clan members',
  2: 'Nobody',
};

export const CLAN_RANKS: Record<ClanMemberRank, string> = {
  10: 'Member',
  20: 'Officer',
  30: 'Co-leader',
  40: 'Leader',
};

export const GAME_TYPES = { ranked: 1, casual: 2 } as const;
export type GameTypeName = keyof typeof GAME_TYPES;

export const LEADERBOARD_TYPES = ['mmr', 'kills', 'deaths', 'assists', 'matches', 'wins', 'losses', 'xp', 'mvp'] as const;

export const MATCH_STATES = ['WaitingForPlayers', 'Starting', 'Freezetime', 'OnGoing', 'BombPlanted', 'Win', 'TeamFlip', 'GameEnd', 'ChangingMap'] as const;

export const INPUT_DEVICES = { keyboard_mouse: 1, touch: 2, gamepad: 4 } as const;
export type InputDevice = keyof typeof INPUT_DEVICES;
