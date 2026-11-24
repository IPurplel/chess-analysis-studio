export type Color = 'w' | 'b';

/** Engine score as printed by UCI: from the point of view of the side to move. */
export interface Score {
  cp?: number;
  mate?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Lichess win-chance model. Returns 0..100 for the side the cp is expressed for. */
export function winPercentFromCp(cp: number): number {
  const c = clamp(cp, -1000, 1000);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Win% (0..100) for the side the score is expressed for. Mate scores saturate. */
export function winPercent(s: Score): number {
  if (s.mate !== undefined && s.mate !== 0) return s.mate > 0 ? 100 : 0;
  return winPercentFromCp(s.cp ?? 0);
}

/** Accuracy of one move from the mover's win% before/after (lichess formula). */
export function moveAccuracy(before: number, after: number): number {
  const loss = Math.max(0, before - after);
  const a = 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411;
  return clamp(a, 0, 100);
}

function stdDev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/**
 * Whole-game accuracy per colour, following lichess: the mean of a
 * volatility-weighted mean and a harmonic mean of per-move accuracies.
 * `winWhite` = White's win% at every position (length = moves + 1).
 */
export function gameAccuracy(
  winWhite: number[],
  startColor: Color = 'w',
): { w: number | null; b: number | null; perMove: number[] } {
  const n = winWhite.length - 1;
  if (n < 1) return { w: null, b: null, perMove: [] };
  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  const pad = new Array(Math.max(0, Math.min(windowSize, n) - 2)).fill(winWhite[0]);
  const all = [...pad, ...winWhite];
  const weights: number[] = [];
  for (let i = 0; i + windowSize <= all.length; i++) {
    weights.push(clamp(stdDev(all.slice(i, i + windowSize)), 0.5, 12));
  }
  const perMove: number[] = [];
  const buckets: Record<Color, { acc: number; w: number }[]> = { w: [], b: [] };
  for (let i = 0; i < n; i++) {
    const color: Color = (i % 2 === 0) === (startColor === 'w') ? 'w' : 'b';
    const before = color === 'w' ? winWhite[i] : 100 - winWhite[i];
    const after = color === 'w' ? winWhite[i + 1] : 100 - winWhite[i + 1];
    const acc = moveAccuracy(before, after);
    perMove.push(acc);
    buckets[color].push({ acc, w: weights[i] ?? 1 });
  }
  const combine = (xs: { acc: number; w: number }[]) => {
    if (!xs.length) return null;
    const wsum = xs.reduce((s, x) => s + x.w, 0);
    const weighted = xs.reduce((s, x) => s + x.acc * x.w, 0) / wsum;
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(x.acc, 0.001), 0);
    return (weighted + harmonic) / 2;
  };
  return { w: combine(buckets.w), b: combine(buckets.b), perMove };
}
