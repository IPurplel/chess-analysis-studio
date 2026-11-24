import { Chess } from 'chess.js';
import { reviewGame, winPercent, type EngineLine } from '@studio/core';
import { evalFen } from './analysis.js';

function sans(fen: string, pv: string[], n: number): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch { break; }
  }
  return out;
}

const povCp = (l: EngineLine) => (l.mate !== undefined && l.mate !== 0 ? (l.mate > 0 ? 10000 : -10000) : l.cp ?? 0);

/**
 * Judge one move the way a game review does: engine evaluation before and after, then the shared
 * classification. Used by puzzles, openings drills and bot games to explain a wrong move.
 */
export async function judgeMove(fen: string, uci: string) {
  const c = new Chess(fen);
  const legal = c.moves({ verbose: true }).find((m) => m.from + m.to + (m.promotion ?? '') === uci);
  if (!legal) throw new Error('illegal move');
  const before = await evalFen(fen);
  c.move({ from: legal.from, to: legal.to, promotion: legal.promotion });
  const afterFen = c.fen();
  const after = c.isGameOver() ? { lines: [] } : await evalFen(afterFen);
  const r = reviewGame({ startFen: fen, moves: [uci], evals: [before, after] });
  const m = r.moves[0];
  return {
    san: legal.san,
    category: m.category,
    kind: m.kind,
    loss: m.loss,
    accuracy: m.accuracy,
    winBefore: m.winBefore,
    winAfter: m.winAfter,
    sacrifice: m.sacrifice,
    best: m.bestUci ? { uci: m.bestUci, san: m.bestSan, line: sans(fen, before.lines[0]?.pv ?? [], 6) } : null,
    top: before.lines.slice(0, 3).map((l) => ({ san: sans(fen, l.pv, 1)[0], line: sans(fen, l.pv, 5), win: winPercent(l), cp: povCp(l), mate: l.mate ?? null })),
    reply: after.lines[0] ? { line: sans(afterFen, after.lines[0].pv, 5), mate: after.lines[0].mate ?? null } : null,
  };
}
