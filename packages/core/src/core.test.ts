import { describe, expect, it } from 'vitest';
import { gameAccuracy, moveAccuracy, reviewGame, sacrificeAmount, winPercent, winPercentFromCp } from './index.js';

const L = (cp: number, ...pv: string[]) => ({ multipv: 1, cp, pv });

describe('win% / accuracy', () => {
  it('matches the lichess model', () => {
    expect(winPercentFromCp(0)).toBeCloseTo(50, 5);
    expect(winPercentFromCp(100)).toBeCloseTo(59.1, 1);
    expect(winPercentFromCp(-100)).toBeCloseTo(40.9, 1);
    expect(winPercent({ mate: 3 })).toBe(100);
    expect(winPercent({ mate: -1 })).toBe(0);
  });
  it('per-move accuracy', () => {
    expect(moveAccuracy(50, 50)).toBeCloseTo(100, 0);
    expect(moveAccuracy(50, 30)).toBeCloseTo(40, 0);
    expect(moveAccuracy(50, 60)).toBeCloseTo(100, 0); // gains are not penalised
  });
  it('game accuracy is not a plain mean (harmonic part pulls blunders down)', () => {
    const win = [50, 50, 50, 50, 10, 10, 10, 10, 10]; // white blunders at ply 2? black moves at odd plies
    const g = gameAccuracy(win);
    const plain = (() => {
      const accs = g.perMove.filter((_, i) => i % 2 === 0);
      return accs.reduce((s, x) => s + x, 0) / accs.length;
    })();
    expect(g.w).not.toBeNull();
    expect(g.w!).toBeLessThan(plain + 1e-9);
  });
});

describe('point of view', () => {
  // moves: 1.e4 e5 2.Nf3 ; positions 0..3
  const moves = ['e2e4', 'e7e5', 'g1f3'];
  it('flags a blunder for Black and for White (evals are side-to-move POV)', () => {
    const evals = [
      { lines: [L(20, 'e2e4')] },            // p0 white to move: +20 white
      { lines: [L(-20, 'e7e5')] },           // p1 black to move: -20 black POV => +20 white
      { lines: [L(900, 'g1f3')] },           // p2 white to move: +900 white => black lost ~40 win%
      { lines: [L(900, 'b8c6')] },           // p3 black to move: +900 black POV => white -900 => white lost
    ];
    const r = reviewGame({ moves, evals });
    expect(r.moves[0].category).not.toBe('blunder');
    expect(r.moves[1].color).toBe('b');
    expect(r.moves[1].category).toBe('blunder');
    expect(r.moves[2].color).toBe('w');
    expect(r.moves[2].category).toBe('blunder');
    expect(r.counts.b.blunder).toBe(1);
    expect(r.counts.w.blunder).toBe(1);
  });
});

describe('terminal positions and mates', () => {
  it('scores checkmate without an engine line (fool\'s mate)', () => {
    const moves = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    const evals = [
      { lines: [L(-10, 'f2f3')] },
      { lines: [L(10, 'e7e5')] },
      { lines: [L(-20, 'g2g4')] },
      { lines: [{ multipv: 1, mate: 1, pv: ['d8h4'] }] }, // black to move, mate in 1
      { lines: [] }, // checkmated: no score
    ];
    const r = reviewGame({ moves, evals });
    const last = r.moves[3];
    expect(last.winAfter).toBe(100);
    expect(['best', 'great']).toContain(last.category);
    expect(r.moves[2].category).toBe('blunder'); // g4 allowed mate in 1
    expect(r.moves[2].kind).toBe('allows-mate');
    expect(r.winWhite.at(-1)).toBe(0);
  });
});

describe('mistake kinds', () => {
  const F = '4k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1';
  it('hangs-piece: moving a rook where it is simply captured', () => {
    const r = reviewGame({
      startFen: F, moves: ['d2d3'],
      evals: [
        { lines: [L(0, 'd2a2')] },
        { lines: [{ multipv: 1, cp: 500, pv: ['d5d3', 'e1e2'] }] }, // black POV +500
      ],
    });
    expect(r.moves[0].category).toBe('blunder');
    expect(r.moves[0].kind).toBe('hangs-piece');
  });
  it('missed-material: the best move won a rook but a quiet move was played', () => {
    const f = '4k3/8/8/3r4/8/8/8/3RK3 w - - 0 1'; // Rxd5+ wins a rook for free
    const r = reviewGame({
      startFen: f, moves: ['e1e2'],
      evals: [
        { lines: [{ multipv: 1, cp: 700, pv: ['d1d5', 'e8e7', 'd5a5'] }] },
        { lines: [{ multipv: 1, cp: 0, pv: ['e8e7'] }] },
      ],
    });
    expect(['mistake', 'blunder']).toContain(r.moves[0].category);
    expect(r.moves[0].kind).toBe('missed-material');
  });
  it('good moves carry no kind', () => {
    const r = reviewGame({ startFen: F, moves: ['d2a2'], evals: [{ lines: [L(0, 'd2a2')] }, { lines: [{ multipv: 1, cp: 0, pv: ['d5d1'] }] }] });
    expect(r.moves[0].kind).toBeNull();
  });
});

describe('great moves', () => {
  it('a plain recapture is never Great, even when it is the only good move', () => {
    const r = reviewGame({
      startFen: '3rk3/8/8/8/8/8/8/3RK3 w - - 0 1',
      moves: ['d1d8', 'e8d8'],
      evals: [
        { lines: [L(0, 'd1d8', 'e8d8')] },
        { lines: [{ multipv: 1, cp: 0, pv: ['e8d8'] }, { multipv: 2, cp: -900, pv: ['e8e7'] }] },
        { lines: [{ multipv: 1, cp: 0, pv: [] }] },
      ],
    });
    expect(r.moves[1].category).not.toBe('great');
  });
  it('a genuine only-move (not a recapture) can be Great', () => {
    const r = reviewGame({
      startFen: '3rk3/8/8/8/8/8/8/3RK3 w - - 0 1',
      moves: ['e1e2'],
      evals: [
        { lines: [{ multipv: 1, cp: 0, pv: ['e1e2'] }, { multipv: 2, cp: -900, pv: ['e1f1'] }] },
        { lines: [{ multipv: 1, cp: 0, pv: ['d8d7'] }] },
      ],
    });
    expect(r.moves[0].category).toBe('great');
  });
});

describe('sacrifice detection', () => {
  const FEN = '3rk3/8/8/8/3p4/8/8/3RK3 w - - 0 1'; // Rxd4? Rxd4 loses a rook for a pawn
  it('counts a real sacrifice', () => {
    expect(sacrificeAmount(FEN, ['d1d4', 'd8d4', 'e1e2'], 'w')).toBe(4);
  });
  it('counts an equal rook trade as zero', () => {
    const f = '3rk3/8/8/8/8/8/8/3RK3 w - - 0 1';
    expect(sacrificeAmount(f, ['d1d8', 'e8d8', 'e1e2'], 'w')).toBe(0);
  });
  it('review: brilliant for a sound sacrifice, not for a plain trade', () => {
    const sac = reviewGame({
      startFen: FEN,
      moves: ['d1d4'],
      evals: [
        { lines: [L(0, 'd1d4', 'd8d4', 'e1e2')] },
        { lines: [{ multipv: 1, cp: 0, pv: ['d8d4', 'e1e2'] }] },
      ],
    });
    expect(sac.moves[0].category).toBe('brilliant');
    const f = '3rk3/8/8/8/8/8/8/3RK3 w - - 0 1';
    const trade = reviewGame({
      startFen: f,
      moves: ['d1d8'],
      evals: [
        { lines: [L(0, 'd1d8', 'e8d8', 'e1e2')] },
        { lines: [{ multipv: 1, cp: 0, pv: ['e8d8', 'e1e2'] }] },
      ],
    });
    expect(trade.moves[0].category).not.toBe('brilliant');
  });
  it('no brilliant when the sacrifice loses the game', () => {
    const r = reviewGame({
      startFen: FEN,
      moves: ['d1d4'],
      evals: [
        { lines: [L(0, 'd1d4', 'd8d4', 'e1e2')] },
        { lines: [{ multipv: 1, cp: 600, pv: ['d8d4', 'e1e2'] }] }, // black POV +600
      ],
    });
    expect(r.moves[0].category).not.toBe('brilliant');
  });
});
