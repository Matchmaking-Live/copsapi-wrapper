# copsapi-wrapper

A typed, quota-aware Node.js client for the [Critical Ops Public API v2](https://criticalopsgame.com/api/).

It covers every endpoint in the API: player profiles, leaderboards, match history, weapon stats, server status, and hosting custom games (Autohost). It also adds the things you'd otherwise build yourself:

- **Every endpoint, fully typed.** The response types match the official OpenAPI spec field for field.
- **Quota management.** The client reads the `X-RateLimit-*` headers and waits for the next minute instead of hitting `429`. It can also keep a reserve of requests for hosting traffic.
- **Safe retries.** Network errors, timeouts and the API's front proxy answering a plain-text `404 Endpoint Not Found.` are retried. `POST` requests are never retried after a failure that could mean the API already acted, so a game is never hosted twice.
- **Batching.** Profile lookups are split into requests of 20, match lookups into requests of 20, and game polling into requests of 50.
- **Unknown players don't break a batch.** The API fails a whole profile request when one player doesn't exist. `profiles.many()` narrows down the missing players and returns everyone else.
- **Caching and duplicate collapsing.** Results are cached in memory, or in your own store such as Redis. Identical requests made at the same time become one.
- **An Autohost toolkit.** Host a room and get its code in one call. A live watcher emits events for joins, leaves, disconnects, score changes, match results and the room ending.
- **A game catalog.** Every hostable game mode and map is included, with name lookup and validation before the request is sent.
- **A CLI** for quick lookups and for hosting and watching rooms from a terminal.
- **No runtime dependencies.** The package ships as both ESM and CommonJS and needs Node.js 20.3 or newer.

## Contents

- [Install](#install)
- [Getting a token](#getting-a-token)
- [Quick start](#quick-start)
- [Client options](#client-options)
- [Profiles](#profiles)
- [Servers](#servers)
- [Match history](#match-history)
- [Weapon stats](#weapon-stats)
- [Leaderboards](#leaderboards)
- [Hosting games (Autohost)](#hosting-games-autohost)
- [Watching hosted games](#watching-hosted-games)
- [Rate limits and the quota](#rate-limits-and-the-quota)
- [Errors](#errors)
- [Caching](#caching)
- [Game catalog](#game-catalog)
- [Named constants](#named-constants)
- [Helpers](#helpers)
- [Command line](#command-line)
- [Field reference](#field-reference)

## Install

```sh
npm install copsapi-wrapper
```

```ts
import { CopsClient } from 'copsapi-wrapper';
const { CopsClient } = require('copsapi-wrapper');
```

## Getting a token

You need your own API token, issued by Critical Force to your Critical Ops account. This package doesn't include a token and never shares one. Tokens look like `cops_` followed by 48 hex digits.

What a token can do depends on its permissions:

| Endpoints | Needs |
| --- | --- |
| Profiles, servers, match history, weapon stats, leaderboards | Any valid token |
| Autohost (`create`, `poll`, `control`, `host`, the watcher) | A token with the `Autohost` permission |

There are three ways to pass the token:

```ts
const cops = new CopsClient('cops_your_token_here');
const cops = new CopsClient({ token: process.env.MY_COPS_TOKEN, timeoutMs: 5000 });
const cops = new CopsClient();
```

The last form reads `COPS_API_TOKEN` from the environment.

- The constructor throws `missing_token` if there is no token.
- It throws `invalid_token` if the token isn't in the `cops_` + 48 hex format. Pass `validateToken: false` if Critical Force changes the format.

A token acts on behalf of the account it was issued to, so keep it on a server and out of your repository. The client refuses to run in a browser unless you pass `dangerouslyAllowBrowser: true`.

### Check your token and its permissions

```ts
const check = await cops.verifyToken();
const canHost = await cops.autohost.isAvailable();
```

- `verifyToken` returns `{ valid, autohost, error, quota }`.
- `isAvailable` returns `true` or `false`. The answer is remembered, so later calls are free.

You can also run `copsapi token` from the command line.

If your token lacks `Autohost`, hosting calls throw `insufficient_permissions` with a message saying which permission is missing. After the first refusal, the client remembers the answer, and further hosting calls fail at once without spending quota. A running watcher stops by itself. Every other endpoint keeps working.

## Quick start

```ts
import { CopsClient, LeaderboardType, careerTotals, describeBan } from 'copsapi-wrapper';

const cops = new CopsClient('cops_your_token_here');

const player = await cops.profiles.get('SomePlayer');
const ranked = careerTotals(player, 'ranked');
console.log(player.basic_info.name, player.stats.ranked.mmr, ranked.kd, describeBan(player.ban) ?? 'not banned');

const top = await cops.leaderboards.top(LeaderboardType.Mmr, 25);
const servers = await cops.servers.online();
```

## Client options

| Option | Default | Description |
| --- | --- | --- |
| `token` | `COPS_API_TOKEN` | Your own API token. Required. It can also be the first constructor argument. |
| `validateToken` | `true` | Check the token format up front. |
| `baseUrl` | `COPS_API_BASE`, or `https://latest.prod.copsapi.criticalforce.fi/api/public/v2` | The API base URL. |
| `timeoutMs` | `10000` | Time allowed for each attempt. |
| `retries` | `2` | Retries for network errors, timeouts and `500`/`503` on `GET` requests. |
| `gatewayRetries` | `5` | Retries when the front proxy answers a non-JSON `404`/`5xx` page. |
| `maxRateLimitWaitSec` | `15` | On a `429`, wait and retry if `Retry-After` is at most this long, otherwise throw. |
| `rateLimit.limit` | `60` | Assumed requests per minute until the API reports the real number. |
| `rateLimit.reserve` | `0` | Requests per minute kept back for high-priority calls (all Autohost calls). |
| `rateLimit.onExhausted` | `'wait'` | `'wait'` for the next minute, or `'throw'` a local `rate_limited` error. |
| `rateLimit.maxWaitMs` | `65000` | Longest time to wait for quota before throwing. |
| `maxConcurrent` | `8` | Requests in flight at once. |
| `dedupe` | `true` | Collapse identical `GET` requests made at the same time. |
| `cache` | in-memory | `false` turns caching off. `{ store, ttl }` sets a custom store or custom TTLs. See [Caching](#caching). |
| `maxPlayersPerRequest` | `20` | Players per `/profile` request. Raise it only if Critical Force raised your token's limit. |
| `authHeader` | `'bearer'` | `'x-api-key'` sends the token as `X-Api-Key` instead. |
| `userAgent` | `copsapi-wrapper/<version>` | `null` sends no `User-Agent` header. |
| `fetch` | `globalThis.fetch` | A custom fetch, for proxies or tests. |
| `hooks` | none | `onRequest`, `onResponse` and `onRetry` callbacks for logging and metrics. |

```ts
const cops = new CopsClient({
  rateLimit: { reserve: 15 },
  hooks: {
    onRetry: ({ path, reason, delayMs }) => console.warn(`retrying ${path} (${reason}) in ${delayMs} ms`),
    onResponse: ({ method, path, status, durationMs }) => metrics.observe(method, path, status, durationMs),
  },
});
```

Every method also accepts `{ signal }` (an `AbortSignal`) and `{ fresh: true }` to skip the cache.

## Profiles

A number is a user id, and a string is a username.

```ts
const one = await cops.profiles.get(123456);
const maybe = await cops.profiles.find('NoSuchPlayer');
const list = await cops.profiles.many([123456, 'Alice', 'Bob']);
const byId = await cops.profiles.byIds([1, 2, 3]);
const byName = await cops.profiles.byUsernames(['Alice', 'Bob']);
```

- `get` throws `user_not_found` when the player doesn't exist.
- `find` returns `null` instead of throwing.
- `many` takes any number of players. It returns them in request order without duplicates, and skips players who don't exist. Pass `{ skipMissing: false }` to throw instead.
- `byIds` returns a `Map<userId, Profile>`.
- `byUsernames` returns a `Map<requested name, Profile>`.

## Servers

```ts
const all = await cops.servers.list();
const online = await cops.servers.online();
const server = await cops.servers.pick({ region: 'EU' });
```

- `list` returns `{ id, name, online, region }` for every server. `region` is guessed from the server name; see `regionOf()`.
- `pick` returns a random online server in the region. If none match, it falls back to any online server; pass `{ fallbackToAny: false }` to get `null` instead. You can also filter with `name: 'DE'` or `name: /^Europe/`.

## Match history

```ts
import { GameType } from 'copsapi-wrapper';

const history = await cops.matches.history(userId);
const [match] = await cops.matches.get([history[0].id]);
const recent = await cops.matches.recent(userId, { limit: 5, gameType: GameType.Ranked });
```

- `history` returns the player's recent matches, newest first. The history resets with each game update.
- `get` returns full scoreboards. Match ids are 64 hex digits, requests are split into groups of 20, and finished matches are cached for an hour.
- `recent` returns `{ entry, match }` pairs, combining history and scoreboards.

## Weapon stats

```ts
import { GameType } from 'copsapi-wrapper';

const ranked = await cops.stats.weapons(userId, GameType.Ranked);
const casual = await cops.stats.weapons(userId, GameType.Casual);
const best = await cops.stats.topWeapons(userId, { gameType: GameType.Ranked, by: 'k', limit: 5 });
```

- The game type is `GameType.Ranked` or `GameType.Casual`; the strings `'ranked'` and `'casual'` work too. Custom games count as casual.
- `topWeapons` adds a `headshotRate` to each weapon.

## Leaderboards

```ts
import { LeaderboardType } from 'copsapi-wrapper';

const page = await cops.leaderboards.page(LeaderboardType.Mmr, { page: 1 });
const elite = await cops.leaderboards.page(LeaderboardType.Mmr, { rank: 9 });

for await (const entry of cops.leaderboards.iterate(LeaderboardType.Kills, { maxPages: 10 })) {
  console.log(entry.position, entry.basic_info.name, entry.score);
}

const top50 = await cops.leaderboards.top(LeaderboardType.Wins, 50);
```

- The types are `LeaderboardType.Mmr`, `Kills`, `Deaths`, `Assists`, `Matches`, `Wins`, `Losses`, `Xp` and `Mvp`; the plain strings (`'mmr'`, `'kills'` and so on) work too. Pages hold 10 entries.
- `page` returns `{ entries, size, pages }`. `rank` (0 to 9) filters to one rank.
- Players move as matches end, so `iterate` skips anyone already yielded on an earlier page.

## Hosting games (Autohost)

This needs a token with the `Autohost` permission. To check before showing hosting features to your users, call `await cops.autohost.isAvailable()`.

### One call: host, wait for the code, add owners

```ts
import { GameModeId, MapId } from 'copsapi-wrapper';

const server = await cops.servers.pick({ region: 'EU' });
const room = await cops.autohost.host({
  serverId: server.id,
  mode: GameModeId.TournamentMode,
  map: MapId.Castello,
  roomName: 'Scrim #42',
  owners: [captainUserId],
});
console.log(`Join with code ${room.code}, password ${room.password}`);
```

- `mode` and `map` take a `GameModeId` and a `MapId`. Names (`'Tournament Mode'`, `'castello'`) and raw ids work too. Combinations the API doesn't allow are refused before the request is sent; pass `validate: false` if Critical Force added a map after this release.
- A random 6-character password is generated unless you pass `password`. Pass `password: false` for an open room.
- `host` throws `game_rejected` if the game server refuses the game (it's full or in maintenance, or the token already hosts 10 games there). It throws `game_gone` or `timeout` if the room never appears.

### Step by step

```ts
const game = await cops.autohost.create({ serverId: 6, mode: GameModeId.Defuse, map: MapId.Raid, roomName: 'Final', password: 'abc' });
const ready = await cops.autohost.waitForRoom(game.id);
const games = await cops.autohost.poll([game.id, otherId]);
const one = await cops.autohost.get(game.id);
```

- `waitForRoom` waits until the room code appears.
- `poll` checks many games at once (up to 50 per request, split automatically).
- `get` returns `null` once the game is gone.

### Room commands

```ts
import { AutohostCommand } from 'copsapi-wrapper';

await cops.autohost.kick(gameId, userId);
await cops.autohost.addOwner(gameId, userId);
await cops.autohost.removeOwner(gameId, userId);
await cops.autohost.restart(gameId);
await cops.autohost.close(gameId);
await cops.autohost.control(gameId, AutohostCommand.Kick, userId);
```

- `kick` removes the player and keeps them out for an hour.
- `addOwner` works before the player joins.
- `close` ends the game; the matches played so far stay in its results.
- `control` is the general form; the other methods call it.

### Rules from the API

- A room closes when nobody joins within 3 minutes, when everyone leaves, or after 3 hours.
- Each game server hosts at most 100 games, and at most 10 per token.
- Game ids are unique within the current game version only.
- `results` lists every match that was played to the end in the room. A match restarted before it ends leaves no result.

## Watching hosted games

The watcher polls every game you track in a single request every 5 seconds, which is how often game servers update. It compares each poll with the previous one and emits events.

```ts
const watcher = cops.autohost.watch();
watcher.track(room.id, { meta: { scrimId: 42 } });

watcher
  .on('roomReady', (game) => announce(game.room.code))
  .on('playerJoin', (game, player, join) => console.log(player.user_id, 'joined after', join.sinceRoomReadyMs, 'ms'))
  .on('playerLeave', (game, player) => console.log(player.user_id, 'left'))
  .on('playerDisconnect', (game, player) => console.log(player.user_id, 'lost connection'))
  .on('playerReconnect', (game, player, offlineMs) => console.log(player.user_id, 'back after', offlineMs, 'ms'))
  .on('score', (game, round, scores) => updateScoreboard(game.id, round, scores))
  .on('matchResult', (game, result) => saveResult(watcher.meta(game.id), summarizeResult(result)))
  .on('ended', (game) => console.log('room closed', game.replay_id))
  .on('gone', (id) => console.log('game', id, 'disappeared'))
  .on('pollError', (err) => console.error(err))
  .start();
```

### Events

| Event | Arguments | When |
| --- | --- | --- |
| `update` | `game, previous` | Every poll. |
| `roomReady` | `game` | The room code first appears. |
| `rejected` | `game, reason` | The game server refused the game. |
| `state` | `game, state, previous` | `match_state` changed. |
| `matchStart` | `game` | A match started or was restarted. |
| `score` | `game, round, scores` | The round or scores changed. |
| `playerJoin` | `game, player, { firstSeenAt, sinceRoomReadyMs }` | A player appeared in the room. |
| `playerLeave` | `game, player` | A player left the room. |
| `playerDisconnect` | `game, player` | Ping dropped to `-1`. |
| `playerReconnect` | `game, player, offlineMs` | Ping came back. |
| `playerTeamChange` | `game, player, previousTeam` | A player switched team. |
| `matchResult` | `game, result, index` | A match finished. Each result fires once. |
| `ended` | `game` | The room closed. The game is untracked unless `untrackEnded: false`. |
| `gone` | `id, lastKnown` | Polling stopped returning the game for `missingGraceMs`. |
| `pollError` | `error` | A poll failed. The watcher keeps going. |

### Options and methods

- `watch({ intervalMs: 5000, missingGraceMs: 60000, untrackEnded: true })`
- `track(id, { meta, seenResults })`, `untrack(id)`, `start()`, `await stop()`, `await pollNow()`
- `latest(id)`, `meta(id)`, `joinTimes(id)`, `roomReadyAt(id)`, `ids`, `size`, `isRunning`

`missingGraceMs` exists because a game created a moment ago can be missing from the first polls.

### Resuming after a restart

To resume after your process restarts, track the game ids again. Pass `seenResults` set to the number of results you already processed, so they aren't emitted twice.

### Late joiners

`joinTimes(id)` and the `playerJoin` event tell you how long each player took to join after the room was ready. You can use that to flag no-shows.

## Rate limits and the quota

Each token gets a quota of requests per wall-clock minute (60 by default). Every authenticated request counts, including failed ones.

The client reads `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` from every response:

```ts
console.log(cops.quota);
```

This prints `{ limit, remaining, resetAt, resetsInMs, reserve }`.

When the quota runs out, requests wait for the next minute by default. With `rateLimit: { onExhausted: 'throw' }` they fail at once with a local `rate_limited` error instead.

If you host games, set `rateLimit.reserve`, for example to `15`. Autohost calls run at high priority and can use the last requests of each minute. Everything else stops early, so a burst of profile lookups can never starve room polling.

Fetching the OpenAPI document (`cops.openApiSpec()`) needs no token and doesn't count toward the quota.

## Errors

Every failure is a `CopsApiError` with a stable `code`:

```ts
import { isCopsError } from 'copsapi-wrapper';

try {
  await cops.profiles.get('ghost');
} catch (err) {
  if (isCopsError(err, 'user_not_found')) return null;
  if (isCopsError(err, 'rate_limited')) console.log(`retry in ${err.retryAfter}s`);
  throw err;
}
```

**API codes:**

| Code | Meaning |
| --- | --- |
| `missing_token`, `invalid_token`, `token_revoked` | The token is missing, wrong or revoked. |
| `insufficient_permissions` | The token lacks the permission the endpoint needs, such as `Autohost`. Ask Critical Force to grant it. |
| `rate_limited` | The quota is used up; wait `retryAfter` seconds. |
| `bad_request` | A parameter is malformed or out of range. |
| `user_not_found` | A requested player doesn't exist. |
| `game_not_found` | The hosted game is gone, belongs to another token, or has no open room. |
| `server_unavailable` | The game server is offline or restarting. |
| `api_disabled` | The API is temporarily disabled. |
| `internal_error` | The API failed. |

**Codes raised by this library:**

| Code | Meaning |
| --- | --- |
| `network` | No answer: DNS, connection or TLS failure. |
| `timeout` | No answer within `timeoutMs`. |
| `aborted` | Your `AbortSignal` fired. |
| `gateway` | The front proxy kept answering with a non-JSON page. |
| `invalid_response` | A 2xx response that isn't JSON. |
| `game_rejected` | The game server refused the hosted game. |
| `game_gone` | The hosted game disappeared. |

Other properties:
- `err.status` is the HTTP status, or `0` if there was no response.
- `err.retryable` tells you whether trying again later can work.
- `err.local` is `true` when the library refused the request without calling the API, for example on validation or to keep the quota reserve.

## Caching

Responses are cached in memory, with up to 5,000 entries. Default lifetimes:

| Data | TTL |
| --- | --- |
| Profiles | 5 minutes |
| Server status | 30 seconds |
| Leaderboard pages | 1 minute |
| Match history | 1 minute |
| Finished matches | 1 hour |
| Weapon stats | 2 minutes |

Autohost calls are never cached. Pass `{ fresh: true }` to any call to skip the cache, or call `cops.clearCache()` to empty it.

To share a cache between processes, give the client any object with `get`, `set(key, value, ttlMs)` and optionally `delete` and `clear`. The methods can be async:

```ts
const cops = new CopsClient({
  cache: {
    ttl: { profile: 60_000 },
    store: {
      get: async (key) => JSON.parse((await redis.get(key)) ?? 'null') ?? undefined,
      set: async (key, value, ttlMs) => void (await redis.set(key, JSON.stringify(value), 'PX', ttlMs)),
    },
  },
});
```

## Game catalog

The game modes and maps that can be hosted through the API:

```ts
import { GAME_MODES, MAPS, gameMode, mapId, mapName, isHostable, mapsFor, modesFor } from 'copsapi-wrapper';

gameMode('tournament');
mapId('Castello');
mapName(613);
isHostable('wingman', 'Grounded');
mapsFor('tournament');
modesFor('Purify');
```

- `gameMode('tournament')` returns `{ id: 15847, key: 'tournament', name: 'Tournament Mode', maps: [...] }`.
- `mapId('Castello')` returns `15391`, and `mapName(613)` returns `'Canals'`.
- `isHostable('wingman', 'Grounded')` returns `false`.

| Mode | `key` | id | Maps |
| --- | --- | --- | --- |
| Defuse | `defuse` | 15773 | Canals, Plaza, Legacy, Grounded, Bureau, Uplink, Yard, Raid, Port, Park, Purify, Arctic, Bout, Soar, Shanty, Village, Castello |
| Elimination | `elimination` | 15775 | Warehouse, Impasse, Overhaul |
| Gungame | `gungame` | 15776 | Brewery, Division, Uplink, Yard, Heat, Warehouse, Gallery, Park, Cargo, Arctic, Bout, Hangar, Impasse, Overhaul |
| Team Deathmatch | `tdm` | 15777 | All 26 maps |
| Manhunt | `manhunt` | 15846 | Purify |
| Tournament Mode | `tournament` | 15847 | Canals, Plaza, Legacy, Grounded, Bureau, Raid, Port, Soar, Village, Castello |
| Rush | `rush` | 15860 | All 26 maps |
| Defend | `defend` | 15861 | Shanty |
| Manhunt Z | `manhuntz` | 18596 | Purify |
| Wingman | `wingman` | 18850 | Canals, Plaza, Legacy, Bureau, Raid, Village, Castello |

The package also exports these label tables:
- `BAN_REASONS`, `USER_TYPES`, `ACCOUNT_AGES`, `PARTY_INVITE_PERMISSIONS` and `CLAN_RANKS`, which map API codes to readable text.
- `LEADERBOARD_TYPES`, `MATCH_STATES`, `GAME_TYPES` and `INPUT_DEVICES`.

## Named constants

Every code the API uses has a named constant, so you don't have to remember what `2` or `15847` means:

```ts
import { BanReason, UserType, MapId, GameModeId, LeaderboardType, AutohostCommand, InputDeviceFlag, hasInputDevice } from 'copsapi-wrapper';

if (profile.ban?.reason === BanReason.Hacking) flagForReview(profile);
if (player.user_type === UserType.Moderator) console.log('a moderator is in the room');

await cops.autohost.create({ serverId, map: MapId.Castello, mode: GameModeId.TournamentMode, roomName: 'Final' });
await cops.autohost.control(gameId, AutohostCommand.Kick, userId);
const page = await cops.leaderboards.page(LeaderboardType.Kills);

hasInputDevice(player.input_device_flags, InputDeviceFlag.Touch);
```

| Constant | Values |
| --- | --- |
| `UserType` | `Spectator`, `User`, `AssistantMod`, `Moderator`, `VeteranMod`, `Developer` |
| `BanType` | `Permanent`, `Temporary` |
| `BanReason` | `Unknown`, `FraudAttempt`, `Hacking`, `Griefing`, `VerbalAbuse`, `Idle`, `Spam`, `ReportAbuse`, `AccountTrading`, `Glitching`, `Ghosting`, `PartyingWithHacker`, `UnderInvestigation`, `MarketplaceAbuse` |
| `ClanMemberRank` | `Member`, `Officer`, `CoLeader`, `Leader` |
| `PartyInvitePermission` | `Anybody`, `OnlyFriendsAndClanMembers`, `Nobody` |
| `AccountAge` | `UnderAWeek` (`'1w'`) to `FourYearsOrMore` (`'5y+'`) |
| `GameType` | `Ranked`, `Casual` |
| `MatchResult` | `Win`, `Loss`, `Draw` |
| `InputDeviceFlag` | `KeyboardMouse`, `Touch`, `Gamepad` (bit flags: use `hasInputDevice`) |
| `MapId` | Every map, such as `Canals` or `Castello` |
| `GameModeId` | Every hostable mode, such as `Defuse`, `TeamDeathmatch` or `TournamentMode` |
| `WinCondition` | `TeamEliminated`, `TeamKills`, `TimeUp`, `Surrendered` |
| `LeaveReason` | `Left`, `Timeout`, `Kicked`, `Banned`, `PingLimit`, `AFK` |
| `MatchState` | `WaitingForPlayers`, `Starting`, `Freezetime`, `OnGoing`, `BombPlanted`, `Win`, `TeamFlip`, `GameEnd`, `ChangingMap` |
| `AutohostCommand` | `Kick`, `Restart`, `RoomOwnerAdd`, `RoomOwnerRemove`, `Close` |
| `LeaderboardType` | `Mmr`, `Kills`, `Deaths`, `Assists`, `Matches`, `Wins`, `Losses`, `Xp`, `Mvp` |
| `GameStatus` | `Open`, `Ended` |

Each constant is a plain `as const` object rather than a TypeScript `enum`. It works the same way in your code, but it also runs under Node's built-in TypeScript support and with the `erasableSyntaxOnly` option. Each one is also a type with the same name:

```ts
function label(reason: BanReason) { ... }
```

Some values can grow as Critical Force updates the game: maps, game modes, win conditions, leave reasons and match states. For those, response fields stay typed as `number` or as an open string, so a new map or reason never breaks your build. The constants list the values known when this version was released; compare against them as usual, and handle unknown values in a `default` branch.

## Helpers

| Helper | Returns |
| --- | --- |
| `careerTotals(profile, 'ranked' \| 'casual' \| 'custom' \| 'all')` | `{ kills, deaths, assists, wins, losses, matches, kd, winRate }` over all seasons. |
| `seasonTotals(profile, season?, scope?)` | The same for one season (the latest by default). |
| `summarizeResult(result)` | Teams sorted by kills, the winner, draw, duration, top fragger and leavers, for autohost results or fetched matches. |
| `describeBan(ban)` | Text such as `"Banned for 3 more days (Griefing)"`. |
| `banReason(ban)` | The reason label. |
| `inputDevices(flags)` | `['keyboard_mouse', 'touch', 'gamepad']`, decoded from `input_device_flags`. |
| `accountAgeLabel(profile)` | Text such as `"Under 3 months"`. |
| `isNewAccount(profile)` | `true` for accounts under a month old. |
| `isStaff(userType)` | `true` for Critical Ops moderators and developers. |
| `kd(kills, deaths)` | The K/D ratio, rounded. |
| `randomPassword(length?)` | A room password without look-alike characters. |
| `regionOf(serverName)` | `'EU'`, `'NA'`, `'SA'`, `'AS'`, `'OC'`, `'ME'`, `'AF'` or `null`, guessed from the name. |

## Command line

```sh
npx copsapi --help
export COPS_API_TOKEN=cops_...

copsapi token
copsapi profile 123456 SomePlayer
copsapi servers
copsapi history 123456
copsapi match <matchId>
copsapi weapons 123456 casual
copsapi leaderboard mmr 1 --rank 9
copsapi host --server 6 --mode tournament --map Castello --name "Scrim" --owner 123456
copsapi watch 812
copsapi control 812 kick 654321
copsapi catalog
copsapi quota
```

Pass your own token with `--token cops_...`, or set `COPS_API_TOKEN`. Add `--json` to any command for raw JSON output.

## Field reference

Responses keep the API's own snake_case field names, exactly as the OpenAPI spec defines them. Inputs to this library's methods are camelCase.

- **Times** are Unix timestamps in seconds.
- **`team`** is `-1` for a player who hasn't picked a team.
- **`ping`** is `-1` while the player is disconnected.
- **`winning_team`** is `-1` when no team won.
- **`ranked.rank`** is `0` while placement matches are left and `9` for Elite Ops.
- **`stats.seasonal_stats`** has one entry per season, each split into `ranked`, `casual` and `custom` totals (`k`, `d`, `a`, `w`, `l`).
- **`ban.days_left`** is `0` for a ban that never ends.
- **`account_age`** is the most the account can be: `1w`, `1m`, `3m`, `1y`, `2y`, `3y`, `4y` or `5y+`.
- **`last_seen_time`** is always an empty string in the public API.
- **`replay_id`** is only set for game modes that record replays, such as Tournament.

The API may add fields at any time, so ignore fields you don't recognise.

## License

MIT. This is an unofficial client; Critical Ops and the Critical Ops API belong to Critical Force.
