import { writeFile } from 'node:fs/promises';
import { CopsClient } from 'copsapi-wrapper';

const cops = new CopsClient(process.env.COPS_API_TOKEN);
const rows = ['position,user_id,name,clan,mmr,wins,losses'];

for await (const entry of cops.leaderboards.iterate('mmr', { rank: 9, maxPages: 20 })) {
  rows.push([entry.position, entry.basic_info.user_id, JSON.stringify(entry.basic_info.name), entry.clan?.basic_info.tag ?? '', entry.score, entry.ranked.wins, entry.ranked.losses].join(','));
}

await writeFile('elite-ops.csv', rows.join('\n'));
console.log(`Saved ${rows.length - 1} players. Requests left this minute: ${cops.quota.remaining}`);
