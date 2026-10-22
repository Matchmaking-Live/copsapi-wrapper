import { describe, expect, it } from 'vitest';
import {
  AccountAge,
  ACCOUNT_AGES,
  AutohostCommand,
  BAN_REASONS,
  BanReason,
  BanType,
  CLAN_RANKS,
  ClanMemberRank,
  CopsClient,
  GAME_MODES,
  GAME_TYPES,
  GameModeId,
  GameType,
  hasInputDevice,
  INPUT_DEVICES,
  InputDeviceFlag,
  LEADERBOARD_TYPES,
  LeaderboardType,
  LeaveReason,
  MAPS,
  MapId,
  MATCH_STATES,
  MatchResult,
  MatchState,
  PARTY_INVITE_PERMISSIONS,
  PartyInvitePermission,
  USER_TYPES,
  UserType,
  WinCondition,
  type Profile,
} from '../src/index.js';
import { game, mockFetch, profile } from './helpers.js';

const values = (o: object) => Object.values(o).sort();
const numericKeys = (o: object) => Object.keys(o).map(Number).sort();

describe('named constants', () => {
  it('cover exactly the codes in the catalog', () => {
    expect(values(MapId)).toEqual(numericKeys(MAPS));
    expect(values(GameModeId)).toEqual(Object.values(GAME_MODES).map((m) => m.id).sort());
    expect(values(BanReason)).toEqual(numericKeys(BAN_REASONS));
    expect(values(UserType)).toEqual(numericKeys(USER_TYPES));
    expect(values(ClanMemberRank)).toEqual(numericKeys(CLAN_RANKS));
    expect(values(PartyInvitePermission)).toEqual(numericKeys(PARTY_INVITE_PERMISSIONS));
    expect(values(AccountAge)).toEqual(Object.keys(ACCOUNT_AGES).sort());
    expect(values(GameType)).toEqual(Object.values(GAME_TYPES).sort());
    expect(values(InputDeviceFlag)).toEqual(Object.values(INPUT_DEVICES).sort());
    expect(values(LeaderboardType)).toEqual([...LEADERBOARD_TYPES].sort());
    expect(values(MatchState)).toEqual([...MATCH_STATES].sort());
  });

  it('use names that match their map and mode', () => {
    for (const [name, id] of Object.entries(MapId)) expect(MAPS[id]).toBe(name);
    expect(GameModeId.TournamentMode).toBe(GAME_MODES.tournament.id);
    expect(GameModeId.TeamDeathmatch).toBe(GAME_MODES.tdm.id);
    expect(GameModeId.ManhuntZ).toBe(GAME_MODES.manhuntz.id);
  });

  it('compare directly with API values', () => {
    const p: Profile = { ...profile(1), ban: { type: BanType.Temporary, reason: BanReason.Hacking, days_left: 3 } };
    expect(p.ban?.reason === BanReason.Hacking).toBe(true);
    expect(p.basic_info.user_type === UserType.User).toBe(true);
    expect([BanType.Permanent, MatchResult.Win, AutohostCommand.Kick, WinCondition.TimeUp, LeaveReason.AFK]).toEqual([0, 1, 'kick', 'TimeUp', 'AFK']);
  });

  it('decode the input device bitmask', () => {
    expect(hasInputDevice(6, InputDeviceFlag.Touch)).toBe(true);
    expect(hasInputDevice(6, InputDeviceFlag.Gamepad)).toBe(true);
    expect(hasInputDevice(6, InputDeviceFlag.KeyboardMouse)).toBe(false);
  });

  it('keep open types open for values the API adds later', () => {
    const condition: WinCondition = 'SomethingNew';
    const reason: LeaveReason = 'NewReason';
    const state: MatchState = 'NewState';
    expect([condition, reason, state]).toHaveLength(3);
  });

  it('can be passed to client methods', async () => {
    const mock = mockFetch((call) => (call.path === '/leaderboards' ? { json: { entries: [], leaderboard_size: 0 } } : { status: 202, json: { autohost: game(1) } }));
    const cops = new CopsClient({ token: 'cops_' + '0'.repeat(48), fetch: mock.fetch });
    await cops.autohost.create({ serverId: 1, map: MapId.Castello, mode: GameModeId.TournamentMode, roomName: 'x' });
    await cops.autohost.control(1, AutohostCommand.Kick, 5);
    await cops.leaderboards.page(LeaderboardType.Kills);
    expect(mock.calls[0]!.body).toMatchObject({ map_id: 15391, game_mode_id: 15847 });
    expect(mock.calls[1]!.body).toMatchObject({ command: 'kick' });
    expect(mock.calls[2]!.query.get('type')).toBe('kills');
  });
});
