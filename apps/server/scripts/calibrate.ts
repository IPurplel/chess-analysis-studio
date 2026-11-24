// Compare our move classification with what chess.com's Game Review shows for the same games.
//
// 1. Open 3-5 of your games in chess.com Game Review and write down the counts it shows for YOU:
//      [{ "game": "https://www.chess.com/game/live/123456789", "brilliant": 1, "great": 2, "mistake": 3, "blunder": 1 }]
//    Save as calibration.json.
// 2. Run:  DB_FILE=<studio.sqlite> npx tsx scripts/calibrate.ts calibration.json
//
// It prints, per game, chess.com's numbers next to ours and the totals, and says which direction our
// thresholds (packages/core/src/review.ts) should move. chess.com does not publish its algorithm, so this is
// the only honest way to bring ours closer.
import { readFileSync } from 'node:fs';
import { db } from '../src/db.js';

type Row = { game: string; brilliant?: number; great?: number; mistake?: number; blunder?: number; inaccuracy?: number };
const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/calibrate.ts calibration.json');
const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
const cats = ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'] as const;
const tot: Record<string, { theirs: number; ours: number }> = Object.fromEntries(cats.map((c) => [c, { theirs: 0, ours: 0 }]));

for (const r of rows) {
  const id = r.game.split('/').pop();
  const g = db.prepare('SELECT id, color FROM games WHERE ext_id = ?').get(id) as { id: number; color: string } | undefined;
  if (!g) { console.log(`not in the database: ${r.game}`); continue; }
  const ours = Object.fromEntries(cats.map((c) => [c,
    (db.prepare('SELECT COUNT(*) n FROM move_stats WHERE game_id=? AND mine=1 AND category=?').get(g.id, c) as { n: number }).n]));
  console.log(r.game);
  for (const c of cats) {
    if (r[c] === undefined) continue;
    tot[c].theirs += r[c]!; tot[c].ours += ours[c];
    console.log(`  ${c.padEnd(11)} chess.com ${String(r[c]).padStart(3)}   ours ${String(ours[c]).padStart(3)}`);
  }
}
console.log('\nTotals');
for (const c of cats) {
  const { theirs, ours } = tot[c];
  if (!theirs && !ours) continue;
  const hint = ours > theirs * 1.3 ? 'we flag too many: tighten' : ours < theirs * 0.7 ? 'we flag too few: loosen' : 'close';
  console.log(`  ${c.padEnd(11)} chess.com ${String(theirs).padStart(3)}   ours ${String(ours).padStart(3)}   ${hint}`);
}
