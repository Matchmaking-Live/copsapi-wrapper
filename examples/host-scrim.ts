import { CopsClient, isCopsError, mapName, summarizeResult } from 'copsapi-wrapper';

const cops = new CopsClient(process.env.COPS_API_TOKEN, { rateLimit: { reserve: 15 } });

if (!(await cops.autohost.isAvailable())) {
  console.error('Your token does not have the Autohost permission, so it cannot host games.');
  process.exit(1);
}
const captains = [111111, 222222];

const server = await cops.servers.pick({ region: 'EU' });
if (!server) throw new Error('No game server is online.');

let room;
try {
  room = await cops.autohost.host({ serverId: server.id, mode: 'tournament', map: 'Castello', roomName: 'Scrim', owners: captains });
} catch (err) {
  if (isCopsError(err, 'game_rejected')) console.error('The game server refused the game:', err.message);
  throw err;
}

console.log(`Room ${room.code} on ${server.name}, password ${room.password}`);

const watcher = cops.autohost.watch().track(room.id);
const LATE_MS = 10 * 60_000;

watcher
  .on('playerJoin', (_game, player, join) => {
    const late = join.sinceRoomReadyMs != null && join.sinceRoomReadyMs > LATE_MS;
    console.log(`${player.user_id} joined${late ? ' late' : ''}`);
  })
  .on('playerDisconnect', (_game, player) => console.log(`${player.user_id} disconnected`))
  .on('score', (_game, round, scores) => console.log(`Round ${round}: ${scores.join(' - ')}`))
  .on('matchResult', async (game, result) => {
    const summary = summarizeResult(result);
    console.log(`${mapName(result.map_id)} finished ${result.scores.join('-')}, top fragger ${summary.topFragger?.user_id}`);
    await cops.autohost.close(game.id);
  })
  .on('ended', async () => {
    console.log('Room closed.');
    await watcher.stop();
  })
  .on('pollError', (err) => console.error('Poll failed:', err))
  .start();
