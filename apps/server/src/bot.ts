import { UciEngine } from './engine.js';

let engine: Promise<UciEngine> | null = null;
let lastKey = '';

function get(): Promise<UciEngine> {
  engine ??= (async () => {
    const e = new UciEngine(undefined, { threads: 1, hash: 32 });
    await e.init();
    return e;
  })();
  return engine;
}

const score = (l: { cp?: number; mate?: number }) => (l.mate !== undefined && l.mate !== 0 ? (l.mate > 0 ? 3000 : -3000) : l.cp ?? 0);

/**
 * Pick a move for a bot of roughly `elo` strength.
 * >= 1320: Stockfish's own UCI_Elo limiter. Below that Stockfish cannot be limited,
 * so we sample among its top moves with a temperature that grows as the Elo falls.
 */
export async function botMove(fen: string, elo: number): Promise<string | null> {
  try {
    return await pick(fen, elo);
  } catch (err) {
    engine = null; // a crashed/timed-out engine is recreated on the next request
    lastKey = '';
    throw err;
  }
}

async function pick(fen: string, elo: number): Promise<string | null> {
  const e = await get();
  const target = Math.max(400, Math.min(3190, Math.round(elo)));
  if (target >= 1320) {
    const k = 'lim' + target;
    if (k !== lastKey) {
      await e.setOption('UCI_LimitStrength', true);
      await e.setOption('UCI_Elo', target);
      lastKey = k;
    }
    const r = await e.analyze(fen, { movetime: 400, multipv: 1 });
    return r.lines[0]?.pv[0] ?? null;
  }
  if (lastKey !== 'full') {
    await e.setOption('UCI_LimitStrength', false);
    lastKey = 'full';
  }
  const r = await e.analyze(fen, { movetime: 60, multipv: 6 });
  if (!r.lines.length) return null;
  const T = 60 + (1320 - target) * 0.55; // centipawns
  const top = score(r.lines[0]);
  const w = r.lines.map((l) => Math.exp((score(l) - top) / T));
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) {
    x -= w[i];
    if (x <= 0) return r.lines[i].pv[0];
  }
  return r.lines[0].pv[0];
}
