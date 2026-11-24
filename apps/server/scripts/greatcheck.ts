// How many "great"/"brilliant" moves are plain recaptures (same destination as the previous move)?
import { db } from '../src/db.js';

const rows = db.prepare('SELECT game_id, json FROM reviews').all() as { game_id: number; json: string }[];
const stat: Record<string, { n: number; recapture: number }> = { great: { n: 0, recapture: 0 }, brilliant: { n: 0, recapture: 0 } };
for (const r of rows) {
  const moves = JSON.parse(r.json).moves as { uci: string; category: string }[];
  moves.forEach((m, i) => {
    if (m.category !== 'great' && m.category !== 'brilliant') return;
    stat[m.category].n++;
    if (i > 0 && moves[i - 1].uci.slice(2, 4) === m.uci.slice(2, 4)) stat[m.category].recapture++;
  });
}
console.log(stat);
