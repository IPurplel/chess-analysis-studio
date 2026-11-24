// Local smoke test: engine + real API. Usage: npx tsx scripts/smoke.ts <chesscom-username>
import { UciEngine } from '../src/engine.js';
import { fetchChessComRatings } from '../src/importers.js';
import { openingsLoaded, detectOpening } from '../src/openings.js';

const user = process.argv[2];
if (!user) throw new Error('usage: tsx scripts/smoke.ts <chesscom-username>');
const e = new UciEngine();
await e.init();
const t = Date.now();
const ev = await e.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { movetime: 300, multipv: 3 });
console.log('engine', Date.now() - t, 'ms', JSON.stringify(ev));
e.quit();
console.log('openings loaded', openingsLoaded());
console.log(detectOpening(['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6']));
console.log('ratings', await fetchChessComRatings(user));
