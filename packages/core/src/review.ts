import { Chess } from 'chess.js';
import { gameAccuracy, moveAccuracy, winPercent, type Color, type Score } from './winpercent.js';
import { nonPawnMaterial, playUci, sacrificeAmount } from './material.js';

/** One engine line. cp/mate are from the point of view of the side to move. */
export interface EngineLine extends Score {
  multipv: number;
  pv: string[]; // UCI moves
}
export interface PositionEval {
  depth?: number;
  lines: EngineLine[];
}

/** Bump when classification rules change; the server re-reviews stored analyses (no engine needed). */
export const REVIEW_VERSION = 2;

export type Category =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export const CATEGORIES: Category[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder',
];

/** Every tunable number lives here so the heuristics are transparent. */
export const DEFAULT_THRESHOLDS = {
  // win% lost by the mover, upper bounds
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  // Great: only-move gap (win% between best and 2nd best line) and max loss
  greatGap: 15,
  greatMaxLoss: 1,
  greatMaxWinBefore: 85,
  // Brilliant
  brilliantMinSacrifice: 2, // pawn units given up net once the line settles
  brilliantMaxLoss: 2,
  brilliantMinWinAfter: 45,
  brilliantMaxWinBefore: 90,
  brilliantMaxRank: 2,
  // phases
  endgameMaterial: 24,
  openingPlies: 20,
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;

export type Phase = 'opening' | 'middlegame' | 'endgame';

export interface MoveReview {
  ply: number; // 0-based
  color: Color;
  uci: string;
  san: string;
  category: Category;
  winBefore: number; // mover POV, best line
  winAfter: number; // mover POV, after the move
  loss: number;
  accuracy: number;
  bestUci: string | null;
  bestSan: string | null;
  evalWhiteCp: number | null; // after the move, white POV, mates clamped
  phase: Phase;
  sacrifice: number;
}

export interface GameReview {
  moves: MoveReview[];
  accuracy: { w: number | null; b: number | null };
  counts: Record<Color, Record<Category, number>>;
  phaseAccuracy: Record<Color, Record<Phase, number | null>>;
  winWhite: number[];
}

const emptyCounts = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

/** Win% for White at a position, handling terminal positions the engine cannot score. */
function whiteWinAt(chess: Chess, ev: PositionEval | undefined): number {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 0 : 100;
  if (chess.isDraw() || chess.isStalemate()) return 50;
  const l = ev?.lines[0];
  if (!l) throw new Error('missing engine evaluation for position ' + chess.fen());
  const povWin = winPercent(l);
  return chess.turn() === 'w' ? povWin : 100 - povWin;
}

function whiteCpAt(chess: Chess, ev: PositionEval | undefined, whiteWin: number): number | null {
  if (chess.isCheckmate() || chess.isDraw() || chess.isStalemate()) return whiteWin === 50 ? 0 : whiteWin > 50 ? 10000 : -10000;
  const l = ev?.lines[0];
  if (!l) return null;
  const cp = l.mate !== undefined && l.mate !== 0 ? (l.mate > 0 ? 10000 : -10000) : (l.cp ?? 0);
  return chess.turn() === 'w' ? cp : -cp;
}

/**
 * Pure game review. `moves` are UCI. `evals[i]` is the analysis of the
 * position before move i; `evals[moves.length]` is the final position
 * (may be empty if the game ended by mate/stalemate/draw).
 */
export function reviewGame(opts: {
  moves: string[];
  evals: PositionEval[];
  startFen?: string;
  bookPlies?: number;
  thresholds?: Partial<Thresholds>;
}): GameReview {
  const T = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const { moves, evals } = opts;
  const bookPlies = opts.bookPlies ?? 0;
  const chess = opts.startFen ? new Chess(opts.startFen) : new Chess();
  const startColor: Color = chess.turn();

  const out: MoveReview[] = [];
  const winWhite: number[] = [];
  const fens: string[] = [chess.fen()];
  const states: Chess[] = [];

  // First pass: replay and collect White win% at every position.
  const replay = new Chess(chess.fen());
  winWhite.push(whiteWinAt(replay, evals[0]));
  states.push(new Chess(replay.fen()));
  for (let i = 0; i < moves.length; i++) {
    playUci(replay, moves[i]);
    winWhite.push(whiteWinAt(replay, evals[i + 1]));
    fens.push(replay.fen());
    states.push(new Chess(replay.fen()));
  }

  const counts: Record<Color, Record<Category, number>> = { w: emptyCounts(), b: emptyCounts() };
  const phaseAcc: Record<Color, Record<Phase, number[]>> = {
    w: { opening: [], middlegame: [], endgame: [] },
    b: { opening: [], middlegame: [], endgame: [] },
  };

  for (let i = 0; i < moves.length; i++) {
    const before = states[i];
    const mover: Color = before.turn();
    const uci = moves[i];
    const lines = evals[i]?.lines ?? [];
    const best = lines[0];

    // Mover POV win%: before = best line, after = the actual position after the move.
    const winBeforeBest = best ? winPercent(best) : mover === 'w' ? winWhite[i] : 100 - winWhite[i];
    const winAfter = mover === 'w' ? winWhite[i + 1] : 100 - winWhite[i + 1];
    const loss = Math.max(0, winBeforeBest - winAfter);

    const legal = before.moves({ verbose: true });
    const san = legal.find((m) => m.from + m.to + (m.promotion ?? '') === uci)?.san ?? uci;
    const bestUci = best?.pv[0] ?? null;
    const bestSan = bestUci ? legal.find((m) => m.from + m.to + (m.promotion ?? '') === bestUci)?.san ?? null : null;
    // A recapture is "only move" by nature (not recapturing loses a piece), so it must not earn Great.
    const playedMove = legal.find((m) => m.from + m.to + (m.promotion ?? '') === uci);
    const prevMove = i > 0
      ? states[i - 1].moves({ verbose: true }).find((m) => m.from + m.to + (m.promotion ?? '') === moves[i - 1])
      : undefined;
    const isRecapture = !!(playedMove?.captured && prevMove?.captured && prevMove.to === playedMove.to);
    const rank = lines.findIndex((l) => l.pv[0] === uci) + 1; // 0 = not in MultiPV
    const isBest = bestUci === uci;
    const second = lines[1];
    const gap = best && second ? winPercent(best) - winPercent(second) : 0;

    const mat = nonPawnMaterial(before);
    const phase: Phase =
      mat <= T.endgameMaterial ? 'endgame' : i < T.openingPlies ? 'opening' : 'middlegame';

    let sacrifice = 0;
    const seq = [uci, ...(evals[i + 1]?.lines[0]?.pv ?? [])];
    try {
      sacrifice = sacrificeAmount(fens[i], seq, mover);
    } catch {
      sacrifice = 0;
    }

    let category: Category;
    if (i < bookPlies) category = 'book';
    else if (
      sacrifice >= T.brilliantMinSacrifice &&
      loss <= T.brilliantMaxLoss &&
      (rank >= 1 && rank <= T.brilliantMaxRank || isBest) &&
      winAfter >= T.brilliantMinWinAfter &&
      winBeforeBest <= T.brilliantMaxWinBefore
    ) category = 'brilliant';
    else if (
      legal.length > 1 &&
      !isRecapture &&
      (isBest || loss <= T.greatMaxLoss) &&
      gap >= T.greatGap &&
      rank === 1 &&
      winBeforeBest <= T.greatMaxWinBefore
    ) category = 'great';
    // "best" only if the numbers agree: a search that later reveals a big drop must not hide it.
    else if ((isBest && loss <= T.excellent) || loss <= 0.0001) category = 'best';
    else if (loss <= T.excellent) category = 'excellent';
    else if (loss <= T.good) category = 'good';
    else if (loss <= T.inaccuracy) category = 'inaccuracy';
    else if (loss <= T.mistake) category = 'mistake';
    else category = 'blunder';

    const accuracy = moveAccuracy(winBeforeBest, winAfter);
    counts[mover][category]++;
    phaseAcc[mover][phase].push(accuracy);
    out.push({
      ply: i, color: mover, uci, san, category, winBefore: winBeforeBest, winAfter, loss, accuracy,
      bestUci, bestSan, evalWhiteCp: whiteCpAt(states[i + 1], evals[i + 1], winWhite[i + 1]), phase, sacrifice,
    });
  }

  const acc = gameAccuracy(winWhite, startColor);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const phaseAccuracy = {
    w: { opening: avg(phaseAcc.w.opening), middlegame: avg(phaseAcc.w.middlegame), endgame: avg(phaseAcc.w.endgame) },
    b: { opening: avg(phaseAcc.b.opening), middlegame: avg(phaseAcc.b.middlegame), endgame: avg(phaseAcc.b.endgame) },
  };
  return { moves: out, accuracy: { w: acc.w, b: acc.b }, counts, phaseAccuracy, winWhite };
}
