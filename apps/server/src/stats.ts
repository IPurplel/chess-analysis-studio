import { db } from './db.js';
import { openingFamily } from './openings.js';

export interface Filters { tc?: string; color?: string; }

function where(profileId: number, f: Filters, alias = 'g') {
  const parts = [`${alias}.profile_id = ?`];
  const args: (string | number)[] = [profileId];
  if (f.tc && f.tc !== 'all') { parts.push(`${alias}.time_class = ?`); args.push(f.tc); }
  if (f.color === 'w' || f.color === 'b') { parts.push(`${alias}.color = ?`); args.push(f.color); }
  return { sql: parts.join(' AND '), args };
}

const CATS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'] as const;

export function gameList(profileId: number, f: Filters, limit = 100, offset = 0) {
  const w = where(profileId, f);
  const rows = db.prepare(`
    SELECT g.id, g.provider, g.url, g.color, g.white, g.black, g.white_rating, g.black_rating, g.result, g.termination,
           g.time_class, g.time_control, g.played_at, g.eco, g.opening, g.plies, g.status,
           r.acc_w, r.acc_b,
           (SELECT group_concat(category || ':' || n) FROM (
              SELECT category, COUNT(*) n FROM move_stats m WHERE m.game_id = g.id AND m.mine = 1 GROUP BY category)) AS cats
    FROM games g LEFT JOIN reviews r ON r.game_id = g.id
    WHERE ${w.sql} ORDER BY g.played_at DESC LIMIT ? OFFSET ?`).all(...w.args, limit, offset) as any[];
  return rows.map((r) => {
    const counts: Record<string, number> = {};
    for (const part of String(r.cats ?? '').split(',').filter(Boolean)) {
      const [k, n] = part.split(':');
      counts[k] = Number(n);
    }
    const { cats: _c, ...rest } = r;
    return { ...rest, accuracy: r.color === 'w' ? r.acc_w : r.acc_b, counts };
  });
}

export function overview(profileId: number, f: Filters) {
  const w = where(profileId, f);
  const games = db.prepare(`
    SELECT g.id, g.color, g.result, g.time_class, g.played_at, g.opening, g.eco, g.white_rating, g.black_rating, g.status,
           g.book_plies, g.termination, g.time_control, g.clocks, r.acc_w, r.acc_b
    FROM games g LEFT JOIN reviews r ON r.game_id = g.id WHERE ${w.sql} ORDER BY g.played_at ASC`).all(...w.args) as any[];

  const mine = db.prepare(`
    SELECT m.game_id, m.category, m.phase, COUNT(*) n, AVG(m.accuracy) acc
    FROM move_stats m JOIN games g ON g.id = m.game_id
    WHERE ${w.sql} AND m.mine = 1 GROUP BY m.game_id, m.category, m.phase`).all(...w.args) as any[];

  const perGame = new Map<number, Record<string, number>>();
  const phaseAcc: Record<string, { s: number; n: number }> = {};
  for (const r of mine) {
    const o = perGame.get(r.game_id) ?? {};
    o[r.category] = (o[r.category] ?? 0) + r.n;
    perGame.set(r.game_id, o);
    const p = (phaseAcc[r.phase] ??= { s: 0, n: 0 });
    p.s += r.acc * r.n; p.n += r.n;
  }

  const totals = { games: games.length, analysed: 0, W: 0, D: 0, L: 0 } as Record<string, number>;
  for (const c of CATS) totals[c] = 0;
  let accSum = 0, accN = 0;
  const timeline: any[] = [];
  const byOpening = new Map<string, any>();
  for (const g of games) {
    totals[g.result]++;
    const counts = perGame.get(g.id);
    const acc = g.color === 'w' ? g.acc_w : g.acc_b;
    if (acc != null) { totals.analysed++; accSum += acc; accN++; }
    if (counts) for (const c of CATS) totals[c] += counts[c] ?? 0;
    const rating = g.color === 'w' ? g.white_rating : g.black_rating;
    timeline.push({ t: g.played_at, rating, accuracy: acc ?? null, result: g.result, tc: g.time_class,
      brilliant: counts?.brilliant ?? 0, blunder: counts?.blunder ?? 0 });

    const fam = openingFamily(g.opening || 'غير مصنّفة');
    const k = g.color + '|' + fam;
    const o = byOpening.get(k) ?? { name: fam, color: g.color, eco: g.eco, n: 0, W: 0, D: 0, L: 0, accS: 0, accN: 0, blunders: 0, analysed: 0, bookS: 0 };
    o.n++; o[g.result]++; o.bookS += g.book_plies ?? 0;
    if (acc != null) { o.accS += acc; o.accN++; o.blunders += counts?.blunder ?? 0; o.analysed++; }
    byOpening.set(k, o);
  }
  const A = totals.analysed || 1;
  const openings = [...byOpening.values()].map((o) => ({
    name: o.name, color: o.color, eco: o.eco, n: o.n, W: o.W, D: o.D, L: o.L,
    score: (o.W + 0.5 * o.D) / o.n,
    accuracy: o.accN ? o.accS / o.accN : null,
    blundersPerGame: o.analysed ? o.blunders / o.analysed : null,
    avgTheoryPlies: o.bookS / o.n, // how many plies you stay inside known opening theory
  })).sort((a, b) => b.n - a.n);

  // Time pressure: a move is "in trouble" when the mover has under 10% of the starting time left.
  const tp = { trouble: { moves: 0, blunders: 0, mistakes: 0 }, normal: { moves: 0, blunders: 0, mistakes: 0 }, games: 0, timeoutLosses: 0, losses: 0 };
  const catByGame = db.prepare(`SELECT m.game_id, m.ply, m.category FROM move_stats m JOIN games g ON g.id = m.game_id WHERE ${w.sql} AND m.mine = 1`).all(...w.args) as any[];
  const movesByGame = new Map<number, { ply: number; category: string }[]>();
  for (const r of catByGame) { const a = movesByGame.get(r.game_id) ?? []; a.push(r); movesByGame.set(r.game_id, a); }
  for (const g of games) {
    if (g.result === 'L') { tp.losses++; if (g.termination === 'timeout' || g.termination === 'outoftime') tp.timeoutLosses++; }
    if (!g.clocks) continue;
    const base = Number(String(g.time_control).split('+')[0].split('/').pop());
    if (!base) continue;
    const clocks: number[] = JSON.parse(g.clocks);
    const ms = movesByGame.get(g.id);
    if (!ms) continue;
    tp.games++;
    for (const m of ms) {
      const left = clocks[m.ply];
      if (left == null) continue;
      const bucket = left < base * 0.1 ? tp.trouble : tp.normal;
      bucket.moves++;
      if (m.category === 'blunder') bucket.blunders++;
      if (m.category === 'mistake') bucket.mistakes++;
    }
  }

  // Per-phase detail, mistake kinds and where in the game the blunders happen.
  const mv = db.prepare(`SELECT m.phase, m.category, m.kind, m.ply, m.loss, m.accuracy FROM move_stats m JOIN games g ON g.id = m.game_id
    WHERE ${w.sql} AND m.mine = 1`).all(...w.args) as any[];
  const phases: Record<string, { moves: number; blunders: number; mistakes: number; inaccuracies: number; lossSum: number; accSum: number }> = {};
  const kinds: Record<string, number> = {};
  const collapse: Record<string, number> = { '1-10': 0, '11-20': 0, '21-30': 0, '31-40': 0, '41+': 0 };
  for (const r of mv) {
    const p = (phases[r.phase] ??= { moves: 0, blunders: 0, mistakes: 0, inaccuracies: 0, lossSum: 0, accSum: 0 });
    p.moves++; p.lossSum += r.loss ?? 0; p.accSum += r.accuracy ?? 0;
    if (r.category === 'blunder') p.blunders++;
    if (r.category === 'mistake') p.mistakes++;
    if (r.category === 'inaccuracy') p.inaccuracies++;
    if (r.category === 'blunder' || r.category === 'mistake') {
      if (r.kind) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      const full = Math.floor(r.ply / 2) + 1;
      collapse[full <= 10 ? '1-10' : full <= 20 ? '11-20' : full <= 30 ? '21-30' : full <= 40 ? '31-40' : '41+']++;
    }
  }
  const phaseDetail = Object.fromEntries(Object.entries(phases).map(([k, p]) => [k, {
    moves: p.moves, blunders: p.blunders, mistakes: p.mistakes, inaccuracies: p.inaccuracies,
    blundersPer100: (100 * p.blunders) / p.moves, avgLoss: p.lossSum / p.moves, accuracy: p.accSum / p.moves,
  }]));

  return {
    insights: { phaseDetail, kinds, collapse },
    timePressure: tp,
    totals: {
      ...totals,
      avgAccuracy: accN ? accSum / accN : null,
      brilliantPerGame: totals.brilliant / A,
      blunderPerGame: totals.blunder / A,
      mistakePerGame: totals.mistake / A,
    },
    phases: Object.fromEntries(Object.entries(phaseAcc).map(([k, v]) => [k, v.n ? v.s / v.n : null])),
    openings,
    timeline,
  };
}
