import { parseArgs } from 'node:util';
import { CopsClient, VERSION } from './client.js';
import { GAME_MODES, LEADERBOARD_TYPES, MAPS, mapName } from './catalog.js';
import { isCopsError } from './errors.js';
import type { AutohostCommand, LeaderboardType } from './enums.js';
import { careerTotals, describeBan, inputDevices, summarizeResult } from './util.js';

const HELP = `copsapi ${VERSION}: Critical Ops Public API v2 from the command line

Usage: copsapi <command> [arguments] [options]

Commands:
  profile <id|username>...              Player profiles
  servers                               Game servers and their status
  history <userId>                      A player's recent matches
  match <matchId>...                    Full scoreboards of matches
  weapons <userId> [ranked|casual]      A player's weapon totals
  leaderboard <type> [page]             A leaderboard page (${LEADERBOARD_TYPES.join(', ')})
  host --server <id> --map <map> --mode <mode> [--name <room>] [--password <pw>] [--owner <userId>]
                                        Host a custom game and wait for its room code
  poll <gameId>...                      Hosted games
  control <gameId> <command> [userId]   kick, restart, room_owner_add, room_owner_remove, close
  watch <gameId>...                     Follow hosted games live and print what happens
  catalog                               Hostable game modes and maps
  quota                                 Requests left this minute
  token                                 Check your token and whether it can host games

Options:
  --token <token>   Your API token (default: COPS_API_TOKEN)
  --base <url>      API base URL (default: COPS_API_BASE or the production API)
  --rank <0-9>      Leaderboard: only players of this rank
  --json            Print raw JSON
  -h, --help        Show this help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    token: { type: 'string' },
    base: { type: 'string' },
    rank: { type: 'string' },
    json: { type: 'boolean', default: false },
    server: { type: 'string' },
    map: { type: 'string' },
    mode: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
    owner: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command, ...args] = positionals;
const out = (data: unknown) => console.log(JSON.stringify(data, null, 2));
const asInt = (v: string | undefined, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a whole number, got ${JSON.stringify(v)}.`);
  return n;
};

async function main() {
  if (values.help || !command) {
    console.log(HELP);
    return;
  }
  if (command === 'catalog') {
    if (values.json) return out({ maps: MAPS, gameModes: GAME_MODES });
    for (const mode of Object.values(GAME_MODES)) console.log(`${mode.name} (${mode.key}, ${mode.id}): ${mode.maps.map((m) => mapName(m)).join(', ')}`);
    return;
  }

  const cops = new CopsClient({ token: values.token, baseUrl: values.base });

  switch (command) {
    case 'profile': {
      const refs = args.map((a) => (/^\d+$/.test(a) ? Number(a) : a));
      const profiles = await cops.profiles.many(refs);
      if (values.json) return out(profiles);
      for (const p of profiles) {
        const t = careerTotals(p);
        const r = p.stats.ranked;
        console.log(`${p.basic_info.name} (${p.basic_info.user_id})${p.clan ? ` [${p.clan.basic_info.tag}]` : ''}`);
        console.log(`  Level ${p.basic_info.player_level.level}, account ${p.account_age}${p.ban ? `, ${describeBan(p.ban)}` : ''}`);
        console.log(`  Ranked: rank ${r.rank}, ${r.mmr} MMR, ${r.wins}W ${r.losses}L${r.placement_matches_left ? `, ${r.placement_matches_left} placements left` : ''}`);
        console.log(`  Career: ${t.kills} kills, K/D ${t.kd}, ${t.matches} matches, ${Math.round(t.winRate * 100)}% won`);
      }
      if (profiles.length < refs.length) console.log(`${refs.length - profiles.length} player(s) not found.`);
      return;
    }
    case 'servers': {
      const servers = await cops.servers.list();
      if (values.json) return out(servers);
      for (const s of servers) console.log(`${String(s.id).padStart(5)}  ${s.online ? 'online ' : 'offline'}  ${s.name}${s.region ? `  (${s.region})` : ''}`);
      return;
    }
    case 'history': {
      const history = await cops.matches.history(asInt(args[0], 'userId'));
      if (values.json) return out(history);
      const results = { 1: 'W', 2: 'L', 3: 'D' } as const;
      for (const h of history) console.log(`${results[h.result]}  ${h.game_type === 1 ? 'ranked' : 'casual'}  ${(mapName(h.map_id) ?? h.map_id).toString().padEnd(10)} ${h.scores.join('-')}${h.left_match ? '  (left)' : ''}  ${h.id}`);
      return;
    }
    case 'match': {
      const matches = await cops.matches.get(args);
      if (values.json) return out(matches);
      for (const m of matches) {
        const s = summarizeResult(m);
        console.log(`${s.map ?? m.map_id}: ${m.scores.join('-')}, ${s.draw ? 'draw' : `team ${s.winningTeam} won`} by ${s.winCondition} in ${Math.round(s.durationSec / 60)} min`);
        for (const team of s.teams) {
          console.log(`  Team ${team.team}${team.won ? ' (won)' : ''}`);
          for (const p of team.players) console.log(`    ${String(p.user_id).padEnd(10)} ${p.kills}/${p.deaths}/${p.assists}  ${p.damage_dealt} dmg  ${inputDevices(p.input_device_flags).join('+')}${p.left_match ? `  left: ${p.leave_reason}` : ''}`);
        }
      }
      return;
    }
    case 'weapons': {
      const type = args[1] === 'casual' ? 'casual' : 'ranked';
      const weapons = await cops.stats.weapons(asInt(args[0], 'userId'), type);
      if (values.json) return out(weapons);
      for (const w of [...weapons].sort((a, b) => b.k - a.k)) console.log(`${w.name.padEnd(16)} ${String(w.k).padStart(7)} kills  ${String(w.h).padStart(7)} headshots  ${String(w.a).padStart(6)} assists`);
      return;
    }
    case 'leaderboard': {
      const type = (args[0] ?? 'mmr') as LeaderboardType;
      if (!LEADERBOARD_TYPES.includes(type)) throw new Error(`Leaderboard type must be one of ${LEADERBOARD_TYPES.join(', ')}.`);
      const page = await cops.leaderboards.page(type, { page: args[1] ? asInt(args[1], 'page') : 1, rank: values.rank !== undefined ? asInt(values.rank, 'rank') : undefined });
      if (values.json) return out(page);
      console.log(`${type} leaderboard, page ${page.page} of ${page.pages} (${page.size} players)`);
      for (const e of page.entries) console.log(`${String(e.position).padStart(6)}  ${String(e.score).padStart(8)}  ${e.basic_info.name}${e.clan ? ` [${e.clan.basic_info.tag}]` : ''}`);
      return;
    }
    case 'host': {
      if (!values.server || !values.map || !values.mode) throw new Error('host needs --server, --map and --mode.');
      const room = await cops.autohost.host({
        serverId: asInt(values.server, '--server'),
        map: /^\d+$/.test(values.map) ? Number(values.map) : values.map,
        mode: /^\d+$/.test(values.mode) ? Number(values.mode) : values.mode,
        roomName: values.name ?? 'Custom game',
        password: values.password,
        owners: (values.owner ?? []).map((o) => asInt(o, '--owner')),
      });
      if (values.json) return out(room);
      console.log(`Game ${room.id} is up. Room code: ${room.code}${room.password ? `, password: ${room.password}` : ''}`);
      return;
    }
    case 'poll': {
      return out(await cops.autohost.poll(args.map((a) => asInt(a, 'gameId'))));
    }
    case 'control': {
      const game = await cops.autohost.control(asInt(args[0], 'gameId'), args[1] as AutohostCommand, args[2] ? asInt(args[2], 'userId') : null);
      if (values.json) return out(game);
      console.log(`Sent ${args[1]} to game ${game.id}.`);
      return;
    }
    case 'watch': {
      const watcher = cops.autohost.watch();
      for (const id of args) watcher.track(asInt(id, 'gameId'));
      const stamp = () => new Date().toLocaleTimeString();
      const log = (id: number, text: string) => console.log(`${stamp()}  #${id}  ${text}`);
      watcher
        .on('roomReady', (g) => log(g.id, `room ready, code ${g.room.code}`))
        .on('state', (g, s) => log(g.id, `state ${s}`))
        .on('score', (g, round, scores) => log(g.id, `round ${round}, ${scores.join('-')}`))
        .on('playerJoin', (g, p, j) => log(g.id, `${p.user_id} joined${j.sinceRoomReadyMs != null ? ` after ${Math.round(j.sinceRoomReadyMs / 1000)}s` : ''}`))
        .on('playerLeave', (g, p) => log(g.id, `${p.user_id} left`))
        .on('playerDisconnect', (g, p) => log(g.id, `${p.user_id} disconnected`))
        .on('playerReconnect', (g, p, ms) => log(g.id, `${p.user_id} reconnected after ${Math.round(ms / 1000)}s`))
        .on('matchResult', (g, r) => log(g.id, `match over on ${mapName(r.map_id) ?? r.map_id}: ${r.scores.join('-')}, winner team ${r.winning_team}`))
        .on('rejected', (g, reason) => log(g.id, `refused by the game server: ${reason ?? 'no reason given'}`))
        .on('ended', (g) => {
          log(g.id, 'ended');
          if (!watcher.size) void watcher.stop();
        })
        .on('gone', (id) => {
          log(id, 'gone');
          if (!watcher.size) void watcher.stop();
        })
        .on('pollError', (err) => console.error(`${stamp()}  poll failed: ${(err as Error).message}`))
        .start();
      process.once('SIGINT', () => void watcher.stop());
      return;
    }
    case 'token': {
      const check = await cops.verifyToken();
      if (values.json) return out({ ...check, error: check.error?.code ?? null });
      if (!check.valid) console.log(`Token rejected: ${check.error?.message}`);
      else console.log(`Token valid. Autohost permission: ${check.autohost ? 'yes, you can host games' : 'no, hosting commands will not work'}. Requests left this minute: ${check.quota.remaining}.`);
      return;
    }
    case 'quota': {
      await cops.servers.list({ fresh: true });
      return out(cops.quota);
    }
    default:
      throw new Error(`Unknown command ${JSON.stringify(command)}. Run copsapi --help.`);
  }
}

main().catch((err: unknown) => {
  if (isCopsError(err)) console.error(`Error (${err.code}${err.status ? `, HTTP ${err.status}` : ''}): ${err.message}`);
  else console.error(`Error: ${(err as Error)?.message ?? err}`);
  process.exitCode = 1;
});
