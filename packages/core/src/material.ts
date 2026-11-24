import { Chess } from 'chess.js';
import type { Color } from './winpercent.js';

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material (pawn units) of `color` minus the opponent's. */
export function materialDiff(chess: Chess, color: Color): number {
  let d = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      d += (sq.color === color ? 1 : -1) * PIECE_VALUE[sq.type];
    }
  }
  return d;
}

/** Total non-pawn, non-king material of both sides (used to detect endgames). */
export function nonPawnMaterial(chess: Chess): number {
  let t = 0;
  for (const row of chess.board())
    for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') t += PIECE_VALUE[sq.type];
  return t;
}

export function playUci(chess: Chess, uci: string) {
  return chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
}

/**
 * How much material (pawn units) `mover` gives up net once the engine line
 * `seq` (starting with the mover's move) settles. We read the state after the
 * last quiet (non-capture) ply of the first few plies, so ordinary trades
 * count as 0 and a real sacrifice shows up as a positive number.
 */
export function sacrificeAmount(fenBefore: string, seq: string[], mover: Color, maxPlies = 6): number {
  const chess = new Chess(fenBefore);
  const before = materialDiff(chess, mover);
  let settled = before;
  let hasSettled = false;
  let last = before;
  const limit = Math.min(seq.length, maxPlies);
  for (let i = 0; i < limit; i++) {
    let mv;
    try {
      mv = playUci(chess, seq[i]);
    } catch {
      break;
    }
    last = materialDiff(chess, mover);
    const quiet = !mv.captured;
    if (quiet && i >= 1) {
      settled = last;
      hasSettled = true;
    }
  }
  // If the line never reached a quiet ply after the first, use where it ended.
  return before - (hasSettled ? settled : last);
}
