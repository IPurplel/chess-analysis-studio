import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';
import { Chess } from 'chess.js';
import { db, tx } from './db.js';

const URL_ = process.env.PUZZLE_DB_URL ?? 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const UA = 'ChessAnalysisStudio/0.1 (self-hosted study tool)';

export const libState = { status: 'idle' as 'idle' | 'downloading' | 'done' | 'error', rows: 0, seen: 0, message: '', error: '' };

// Themes that teach something a learner can act on; the first match names a puzzle's bucket.
const PRIORITY = [
  'mateIn1', 'mateIn2', 'mateIn3', 'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRankMate',
  'trappedPiece', 'deflection', 'attraction', 'sacrifice', 'doubleCheck', 'smotheredMate', 'xRayAttack',
  'capturingDefender', 'intermezzo', 'quietMove', 'advancedPawn', 'promotion', 'defensiveMove', 'exposedKing',
  'rookEndgame', 'pawnEndgame', 'queenEndgame', 'bishopEndgame', 'knightEndgame', 'endgame', 'opening', 'middlegame',
];
const bucketTheme = (themes: string[]) => PRIORITY.find((t) => themes.includes(t)) ?? themes[0] ?? 'other';
const CAP_PER_BUCKET = 45; // puzzles kept per (theme x 100-rating band) => ~20k rows overall

export function libraryCount(): number {
  return (db.prepare('SELECT COUNT(*) n FROM lib_puzzles').get() as { n: number }).n;
}

/** Stream the official CSV, keep a rating-appropriate, popular, balanced subset, never hold the file in memory. */
export async function importLibrary(): Promise<void> {
  if (libState.status === 'downloading') return;
  Object.assign(libState, { status: 'downloading', rows: 0, seen: 0, error: '', message: 'جارٍ تنزيل قاعدة التمارين…' });
  db.prepare("DELETE FROM meta WHERE key='lib_done'").run();
  db.exec('DELETE FROM lib_puzzles'); // restart cleanly: a half-finished earlier run must not count as a library
  try {
    const res = await fetch(URL_, { headers: { 'User-Agent': UA } });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const lines = createInterface({ input: Readable.fromWeb(res.body as any).pipe(createZstdDecompress()), crlfDelay: Infinity });
    const counts = new Map<string, number>();
    const ins = db.prepare('INSERT OR IGNORE INTO lib_puzzles(id,fen,moves,rating,themes,opening_tags,game_url) VALUES (?,?,?,?,?,?,?)');
    let batch: any[][] = [];
    const flush = () => {
      if (!batch.length) return;
      const b = batch; batch = [];
      tx(() => { for (const r of b) ins.run(...r); });
    };
    for await (const line of lines) {
      if (line.startsWith('PuzzleId')) continue; // header (present in some dumps)
      libState.seen++;
      const f = line.split(',');
      if (f.length < 9) continue;
      const rating = +f[3], popularity = +f[5], plays = +f[6];
      if (!(rating >= 400 && rating <= 1800 && popularity >= 80 && plays >= 500)) continue;
      const themes = f[7].split(' ');
      const key = bucketTheme(themes) + '|' + Math.floor(rating / 100);
      const n = counts.get(key) ?? 0;
      if (n >= CAP_PER_BUCKET) continue;
      counts.set(key, n + 1);
      batch.push([f[0], f[1], f[2], rating, f[7], f[9] ?? '', f[8] ?? '']);
      libState.rows++;
      if (batch.length >= 500) flush();
      if (libState.seen % 200000 === 0) libState.message = `تمت معالجة ${libState.seen.toLocaleString('en')} صف…`;
    }
    flush();
    if (libState.rows < 1000) throw new Error('الملف لا يبدو بصيغة قاعدة التمارين المتوقعة');
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('lib_done', ?)").run(String(Date.now()));
    Object.assign(libState, { status: 'done', message: `جاهز: ${libState.rows} تمرين` });
  } catch (e: any) {
    Object.assign(libState, { status: 'error', error: String(e?.message ?? e), message: 'فشل تنزيل التمارين' });
  }
}

/** First start: fetch the library in the background so training is ready without any manual step. */
export function ensureLibrary() {
  if (process.env.PUZZLE_LIBRARY === '0' || process.env.NO_ENGINE === '1') return;
  const n = libraryCount();
  const finished = !!db.prepare("SELECT 1 FROM meta WHERE key='lib_done'").get();
  if (finished && n > 0) { Object.assign(libState, { status: 'done', rows: n, message: `جاهز: ${n} تمرين` }); return; }
  importLibrary();
}

// ----------------------------------------------------------------------------- serving
export interface LibPuzzle {
  id: string; fen: string; setup: [string, string]; solution: string[]; rating: number; themes: string[]; opening: string; url: string;
  orientation: 'white' | 'black';
}

const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function puzzleRating(profileId: number, seedFrom?: number | null): number {
  const r = db.prepare('SELECT rating FROM puzzle_profile WHERE profile_id=?').get(profileId) as any;
  if (r) return r.rating;
  // Start well below the tactics rating if we know it: puzzles are for building the habit of checking
  // everything before moving, so they should be solvable; the rating then adapts after each attempt.
  const start = seedFrom ? Math.max(600, Math.min(1000, seedFrom - 700)) : 800;
  db.prepare('INSERT OR IGNORE INTO puzzle_profile(profile_id, rating) VALUES (?,?)').run(profileId, start);
  return start;
}

function toPuzzle(row: any): LibPuzzle | null {
  const moves = String(row.moves).split(' ');
  const c = new Chess(row.fen);
  let setup: [string, string];
  try {
    const m = c.move({ from: moves[0].slice(0, 2), to: moves[0].slice(2, 4), promotion: moves[0][4] });
    setup = [m.from, m.to];
  } catch { return null; }
  return {
    id: row.id, fen: c.fen(), setup, solution: moves.slice(1), rating: row.rating, themes: String(row.themes).split(' '),
    opening: row.opening_tags ?? '', url: row.game_url ?? '', orientation: c.turn() === 'w' ? 'white' : 'black',
  };
}

export function nextLibraryPuzzle(profileId: number, rating: number, theme?: string): LibPuzzle | null {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  for (const [lo, hi] of [[-100, 150], [-250, 300], [-600, 700]]) {
    const args: (string | number)[] = [rating + lo, rating + hi, profileId, since];
    let themeSql = '';
    if (theme) { themeSql = " AND (' ' || p.themes || ' ') LIKE ?"; args.push(`% ${theme} %`); }
    const row = db.prepare(`
      SELECT p.* FROM lib_puzzles p
      WHERE p.rating BETWEEN ? AND ? ${''}
        AND NOT EXISTS (SELECT 1 FROM lib_attempts a WHERE a.profile_id = ? AND a.puzzle_id = p.id AND a.at > ?)
        ${themeSql}
      ORDER BY RANDOM() LIMIT 1`).get(...args) as any;
    if (row) return toPuzzle(row);
  }
  return null;
}

export function recordAttempt(profileId: number, puzzleId: string, solved: boolean, hints: number, ms: number | null) {
  const p = db.prepare('SELECT rating, themes FROM lib_puzzles WHERE id=?').get(puzzleId) as any;
  if (!p) return null;
  const before = puzzleRating(profileId);
  const expected = 1 / (1 + 10 ** ((p.rating - before) / 400));
  const score = solved ? (hints > 0 ? 0.6 : 1) : 0;
  const after = Math.max(400, Math.min(2200, before + 24 * (score - expected)));
  const day = dayKey();
  tx(() => {
    db.prepare('UPDATE puzzle_profile SET rating=? WHERE profile_id=?').run(after, profileId);
    db.prepare('INSERT INTO lib_attempts(profile_id,puzzle_id,solved,hints,ms,themes,rating_before,rating_after,at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(profileId, puzzleId, solved ? 1 : 0, hints, ms, p.themes, before, after, Math.floor(Date.now() / 1000));
    db.prepare(`INSERT INTO activity(profile_id,day,puzzles,correct) VALUES (?,?,1,?)
      ON CONFLICT(profile_id,day) DO UPDATE SET puzzles=puzzles+1, correct=correct+excluded.correct`).run(profileId, day, solved ? 1 : 0);
  });
  return { before, after };
}

/** Consecutive days (ending today or yesterday) with at least one solved puzzle. */
export function streak(profileId: number): number {
  const rows = db.prepare('SELECT day FROM activity WHERE profile_id=? AND puzzles>0 ORDER BY day DESC LIMIT 60').all(profileId) as { day: string }[];
  const set = new Set(rows.map((r) => r.day));
  let d = new Date();
  if (!set.has(dayKey(+d))) d = new Date(+d - 86400000);
  let n = 0;
  while (set.has(dayKey(+d))) { n++; d = new Date(+d - 86400000); }
  return n;
}

export function themeStats(profileId: number) {
  const rows = db.prepare('SELECT themes, solved FROM lib_attempts WHERE profile_id=?').all(profileId) as { themes: string; solved: number }[];
  const m = new Map<string, { n: number; ok: number }>();
  for (const r of rows) for (const t of String(r.themes).split(' ')) {
    if (!PRIORITY.includes(t)) continue;
    const x = m.get(t) ?? { n: 0, ok: 0 };
    x.n++; x.ok += r.solved;
    m.set(t, x);
  }
  return [...m.entries()].map(([theme, v]) => ({ theme, attempts: v.n, solved: v.ok })).sort((a, b) => b.attempts - a.attempts);
}
