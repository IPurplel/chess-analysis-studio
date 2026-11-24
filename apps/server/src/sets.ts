import { db, tx } from './db.js';
import { puzzleRating, toPuzzle } from './library.js';
import { KIND_THEMES } from './sprint.js';

/** A new release (git commit baked into the image) means a brand-new set of puzzles. */
export const RELEASE = process.env.BUILD_SHA || 'dev';
const SIZE = 100;
const DIVERSE = ['mateIn1', 'mateIn2', 'fork', 'pin', 'skewer', 'hangingPiece', 'backRankMate', 'discoveredAttack', 'trappedPiece', 'deflection', 'sacrifice', 'defensiveMove'];

function weakThemes(profileId: number): string[] {
  const rows = db.prepare(`SELECT kind, COUNT(*) n FROM move_stats WHERE profile_id=? AND mine=1 AND kind IS NOT NULL AND category IN ('blunder','mistake')
    GROUP BY kind ORDER BY n DESC`).all(profileId) as { kind: string; n: number }[];
  const out: string[] = [];
  for (const r of rows) for (const t of KIND_THEMES[r.kind] ?? []) if (!out.includes(t)) out.push(t);
  return out.length ? out : ['hangingPiece', 'mateIn1', 'fork'];
}

function pick(profileId: number, theme: string | null, n: number, lo: number, hi: number, exclude: Set<string>): { id: string; rating: number }[] {
  if (n <= 0) return [];
  const args: (string | number)[] = [lo, hi, profileId, profileId, Math.floor(Date.now() / 1000) - 30 * 86400];
  let themeSql = '';
  if (theme) { themeSql = " AND (' ' || p.themes || ' ') LIKE ?"; args.push(`% ${theme} %`); }
  const rows = db.prepare(`
    SELECT p.id, p.rating FROM lib_puzzles p
    WHERE p.rating BETWEEN ? AND ?
      AND p.id NOT IN (SELECT i.puzzle_id FROM puzzle_set_items i JOIN puzzle_sets s ON s.id = i.set_id WHERE s.profile_id = ?)
      AND p.id NOT IN (SELECT puzzle_id FROM lib_attempts WHERE profile_id = ? AND at > ?)
      ${themeSql}
    ORDER BY RANDOM() LIMIT ${n * 3}`).all(...args) as { id: string; rating: number }[];
  const out: { id: string; rating: number }[] = [];
  for (const r of rows) { if (!exclude.has(r.id)) { exclude.add(r.id); out.push(r); if (out.length >= n) break; } }
  return out;
}

export function buildSet(profileId: number, seedTactics: number | null): number {
  const r = puzzleRating(profileId, seedTactics);
  const chosen: { id: string; rating: number }[] = [];
  const seen = new Set<string>();
  const weak = weakThemes(profileId);
  for (const [lo, hi] of [[r - 400, r + 300], [r - 600, r + 600], [400, 2000]]) {
    // 40% aimed at your own weak spots, the rest spread over the main tactical patterns
    const weakEach = Math.ceil(40 / weak.length);
    for (const t of weak) if (chosen.length < SIZE) chosen.push(...pick(profileId, t, Math.min(weakEach, 40 - chosen.length), lo, hi, seen));
    const each = Math.ceil((SIZE - chosen.length) / DIVERSE.length) + 1;
    for (const t of DIVERSE) chosen.push(...pick(profileId, t, Math.min(each, SIZE - chosen.length), lo, hi, seen));
    if (chosen.length < SIZE) chosen.push(...pick(profileId, null, SIZE - chosen.length, lo, hi, seen));
    if (chosen.length >= SIZE) break;
  }
  chosen.sort((a, b) => a.rating - b.rating);
  return tx(() => {
    const setId = Number(db.prepare('INSERT INTO puzzle_sets(profile_id, release, created_at) VALUES (?,?,?)').run(profileId, RELEASE, Math.floor(Date.now() / 1000)).lastInsertRowid);
    const ins = db.prepare('INSERT INTO puzzle_set_items(set_id, idx, puzzle_id) VALUES (?,?,?)');
    chosen.slice(0, SIZE).forEach((c, i) => ins.run(setId, i + 1, c.id));
    return setId;
  });
}

export function currentSetId(profileId: number, seedTactics: number | null, forceNew = false): number | null {
  if (!forceNew) {
    const s = db.prepare('SELECT id FROM puzzle_sets WHERE profile_id=? AND release=? ORDER BY id DESC LIMIT 1').get(profileId, RELEASE) as { id: number } | undefined;
    if (s) return s.id;
  }
  const lib = (db.prepare('SELECT COUNT(*) n FROM lib_puzzles').get() as { n: number }).n;
  if (lib < 200) return null; // library still downloading
  return buildSet(profileId, seedTactics);
}

export function setOverview(profileId: number, setId: number) {
  const s = db.prepare('SELECT id, release, created_at FROM puzzle_sets WHERE id=? AND profile_id=?').get(setId, profileId) as any;
  if (!s) return null;
  const items = db.prepare(`SELECT i.idx, i.puzzle_id AS id, i.status, i.attempts, p.rating, p.themes FROM puzzle_set_items i JOIN lib_puzzles p ON p.id = i.puzzle_id
    WHERE i.set_id=? ORDER BY i.idx`).all(setId) as any[];
  const counts = { solved: 0, failed: 0, new: 0 } as Record<string, number>;
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  return { set: { id: s.id, release: s.release, createdAt: s.created_at }, items: items.map((i) => ({ ...i, themes: String(i.themes).split(' ').slice(0, 3) })), counts };
}

export function setItemPuzzle(profileId: number, setId: number, idx: number) {
  const row = db.prepare(`SELECT p.* FROM puzzle_set_items i JOIN puzzle_sets s ON s.id = i.set_id JOIN lib_puzzles p ON p.id = i.puzzle_id
    WHERE s.id=? AND s.profile_id=? AND i.idx=?`).get(setId, profileId, idx) as any;
  return row ? toPuzzle(row) : null;
}

export function markSetItem(profileId: number, setId: number, puzzleId: string, solved: boolean) {
  const own = db.prepare('SELECT 1 FROM puzzle_sets WHERE id=? AND profile_id=?').get(setId, profileId);
  if (!own) return;
  db.prepare(`UPDATE puzzle_set_items SET attempts = attempts + 1, updated_at = ?,
      status = CASE WHEN ? = 1 THEN 'solved' WHEN status = 'solved' THEN 'solved' ELSE 'failed' END
    WHERE set_id=? AND puzzle_id=?`).run(Math.floor(Date.now() / 1000), solved ? 1 : 0, setId, puzzleId);
}
