// Sanity-check the endgame drill positions (apps/web/src/pages/Play.tsx) with Stockfish.
// Wins must evaluate clearly for the side the user plays; the draw must be ~0.
import { Chess } from 'chess.js';
import { UciEngine } from '../src/engine.js';

const E: Record<string, { fen: string; expect: 'win' | 'draw' }> = {
  kqk: { fen: '8/8/8/4k3/8/8/4K3/7Q w - - 0 1', expect: 'win' },
  krk: { fen: '8/8/8/4k3/8/8/4K3/7R w - - 0 1', expect: 'win' },
  lucena: { fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', expect: 'win' },
  kpkWin: { fen: '8/8/2k5/4K3/3P4/8/8/8 w - - 0 1', expect: 'win' },
  kpkDraw: { fen: '8/8/4k3/8/4PK2/8/8/8 w - - 0 1', expect: 'draw' },
};
const e = new UciEngine();
await e.init();
let bad = 0;
for (const [k, { fen, expect }] of Object.entries(E)) {
  new Chess(fen);
  const r = await e.analyze(fen, { depth: 24, multipv: 1 });
  const l = r.lines[0];
  const ok = expect === 'win' ? (l?.mate ?? 0) > 0 || (l?.cp ?? 0) > 400 : Math.abs(l?.cp ?? 99) < 30 && l?.mate === undefined;
  if (!ok) bad++;
  console.log(k.padEnd(8), expect.padEnd(5), JSON.stringify({ cp: l?.cp, mate: l?.mate }), ok ? 'ok' : 'MISMATCH');
}
e.quit();
process.exit(bad ? 1 : 0);
