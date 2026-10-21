import { CopsClient, careerTotals, describeBan, accountAgeLabel } from 'copsapi-wrapper';

const cops = new CopsClient(process.env.COPS_API_TOKEN);
const name = process.argv[2] ?? 'SomePlayer';

const player = await cops.profiles.find(name);
if (!player) {
  console.log(`${name} does not exist.`);
  process.exit(1);
}

const ranked = careerTotals(player, 'ranked');
const weapons = await cops.stats.topWeapons(player.basic_info.user_id, { limit: 3 });

console.log(`${player.basic_info.name}${player.clan ? ` [${player.clan.basic_info.tag}]` : ''}, level ${player.basic_info.player_level.level}`);
console.log(`Account age: ${accountAgeLabel(player)}. ${describeBan(player.ban) ?? 'Not banned.'}`);
console.log(`Rank ${player.stats.ranked.rank}, ${player.stats.ranked.mmr} MMR`);
console.log(`Ranked career: K/D ${ranked.kd}, ${Math.round(ranked.winRate * 100)}% of ${ranked.matches} matches won`);
console.log(`Best weapons: ${weapons.map((w) => `${w.name} (${w.k} kills, ${Math.round(w.headshotRate * 100)}% headshots)`).join(', ')}`);
