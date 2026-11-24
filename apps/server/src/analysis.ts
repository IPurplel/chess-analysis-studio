import { Chess } from 'chess.js';
import { reviewGame, playUci, REVIEW_VERSION, type PositionEval } from '@studio/core';
import { db, tx } from './db.js';
import { EnginePool } from './engine.js';

const MOVETIME = Number(process.env.ANALYSIS_MOVETIME) || 250;
const MULTIPV = 3;
const keyOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ') + `|t${MOVETIME}|m${MULTIPV}`;

export const state = { running: false, current: null as null | { gameId: number; done: number; total: number }, workers: 0 };
let pool: EnginePool | null = null;
let wake: (() => void) | null = null;

export function kick() { wake?.(); }

async function evalFen(fen: string): Promise<PositionEval> {
  const k = keyOf(fen);
  const hit = db.prepare('SELECT json FROM evals WHERE key=?').get(k) as { json: string } | undefined;
  if (hit) return JSON.parse(hit.json);
  const ev = await pool!.analyze(fen, { movetime: MOVETIME, multipv: MULTIPV });
  db.prepare('INSERT OR REPLACE INTO evals(key,json) VALUES (?,?)').run(k, JSON.stringify(ev));
  return ev;
}

export async function analyseGame(gameId: number): Promise<void> {
  const g = db.prepare('SELECT * FROM games WHERE id=?').get(gameId) as any;
  const moves: string[] = JSON.parse(g.moves_uci);
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const m of moves) { playUci(chess, m); fens.push(chess.fen()); }
  const terminal = (f: string) => { const c = new Chess(f); return c.isGameOver(); };

  state.current = { gameId, done: 0, total: fens.length };
  const evals: PositionEval[] = new Array(fens.length);
  let next = 0;
  const workers = Array.from({ length: pool!.size }, async () => {
    while (true) {
      const i = next++;
      if (i >= fens.length) return;
      evals[i] = terminal(fens[i]) ? { lines: [] } : await evalFen(fens[i]);
      state.current!.done++;
    }
  });
  await Promise.all(workers);

  persist(g, evals, fens, true);
  state.current = null;
}

/** Classify stored evals and write the review + per-move stats (+ puzzles for fresh analyses). */
function persist(g: any, evals: PositionEval[], fens0: string[], withPuzzles: boolean) {
  const moves: string[] = JSON.parse(g.moves_uci);
  let fens = fens0;
  if (withPuzzles && fens.length === 0) {
    const c = new Chess();
    fens = [c.fen()];
    for (const m of moves) { playUci(c, m); fens.push(c.fen()); }
  }
  const review = reviewGame({ moves, evals, bookPlies: g.book_plies ?? 0, ratings: { w: g.white_rating, b: g.black_rating } });
  const mineColor = g.color as 'w' | 'b';
  tx(() => {
    db.prepare('INSERT OR REPLACE INTO reviews(game_id,json,acc_w,acc_b,analysed_at,version) VALUES (?,?,?,?,?,?)')
      .run(g.id, JSON.stringify({ ...review, evals }), review.accuracy.w, review.accuracy.b, Math.floor(Date.now() / 1000), REVIEW_VERSION);
    db.prepare('DELETE FROM move_stats WHERE game_id=?').run(g.id);
    const ins = db.prepare('INSERT INTO move_stats(game_id,profile_id,ply,mine,category,phase,loss,accuracy,kind) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const m of review.moves) ins.run(g.id, g.profile_id, m.ply, m.color === mineColor ? 1 : 0, m.category, m.phase, m.loss, m.accuracy, m.kind);
    if (withPuzzles) {
      // Puzzles from the player's own mistakes/blunders (position before the move, engine line as the answer).
      const puz = db.prepare(`INSERT INTO puzzles(profile_id,game_id,ply,fen,solution,played,category,theme,due_at) VALUES (?,?,?,?,?,?,?,?,0)
        ON CONFLICT(profile_id,game_id,ply) DO UPDATE SET solution=excluded.solution, category=excluded.category, theme=excluded.theme`);
      for (const m of review.moves) {
        if (m.color !== mineColor || (m.category !== 'blunder' && m.category !== 'mistake')) continue;
        const line = evals[m.ply]?.lines[0];
        if (!line || line.pv.length === 0) continue;
        puz.run(g.profile_id, g.id, m.ply, fens[m.ply], JSON.stringify(line.pv.slice(0, 8)), m.uci, m.category, m.phase);
      }
    }
    db.prepare("UPDATE games SET status='done', error=NULL WHERE id=?").run(g.id);
  });
}

/** After a rules change (REVIEW_VERSION bump) re-classify stored analyses. Needs no engine. */
export async function rereviewOutdated(): Promise<number> {
  const ids = db.prepare('SELECT game_id FROM reviews WHERE COALESCE(version,1) < ?').all(REVIEW_VERSION) as { game_id: number }[];
  for (const { game_id } of ids) {
    const g = db.prepare('SELECT * FROM games WHERE id=?').get(game_id) as any;
    const r = db.prepare('SELECT json FROM reviews WHERE game_id=?').get(game_id) as { json: string } | undefined;
    if (!g || !r) continue;
    try {
      persist(g, JSON.parse(r.json).evals as PositionEval[], [], true);
    } catch (e) {
      console.error('re-review failed for game', game_id, (e as Error).message);
    }
    await new Promise((res) => setImmediate(res)); // never starve the web server: it must answer health checks while this runs
  }
  return ids.length;
}

export async function startWorker() {
  if (state.running) return;
  state.running = true;
  pool = await new EnginePool().start();
  state.workers = pool.size;
  // Anything left "running" from a previous crash goes back to the queue.
  db.exec("UPDATE games SET status='pending' WHERE status='running'");
  (async () => {
    while (true) {
      const row = db.prepare("SELECT id FROM games WHERE status='pending' ORDER BY priority DESC, played_at DESC LIMIT 1").get() as { id: number } | undefined;
      if (!row) {
        await new Promise<void>((r) => { wake = r; setTimeout(r, 15000); });
        continue;
      }
      db.prepare("UPDATE games SET status='running' WHERE id=?").run(row.id);
      try {
        await analyseGame(row.id);
      } catch (e: any) {
        db.prepare("UPDATE games SET status='error', error=? WHERE id=?").run(String(e?.message ?? e), row.id);
        state.current = null;
      }
    }
  })();
}

export function queueStats(profileId?: number) {
  const where = profileId ? 'WHERE profile_id=?' : '';
  const args = profileId ? [profileId] : [];
  const rows = db.prepare(`SELECT status, COUNT(*) n FROM games ${where} GROUP BY status`).all(...args) as { status: string; n: number }[];
  return { byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])), current: state.current, workers: state.workers };
}
