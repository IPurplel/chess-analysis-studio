import { describe, expect, it } from 'vitest';
import { parseInfo } from './engine.js';
import { normalizeChessCom, normalizeLichess } from './importers.js';

describe('UCI info parsing', () => {
  it('reads cp scores, multipv and the pv', () => {
    const r = parseInfo('info depth 16 seldepth 24 multipv 2 score cp -34 nodes 1000 nps 1 time 5 pv e2e4 e7e5 g1f3');
    expect(r).toMatchObject({ depth: 16, multipv: 2, cp: -34, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });
  it('reads mate scores', () => {
    expect(parseInfo('info depth 9 multipv 1 score mate -2 pv e1e2')).toMatchObject({ mate: -2 });
  });
  it('ignores bounds, strings and lines without a pv', () => {
    expect(parseInfo('info depth 5 score cp 10 lowerbound pv e2e4')).toBeNull();
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseInfo('info depth 5 score cp 10')).toBeNull();
  });
});

describe('importers', () => {
  const pgn = '[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';
  it('chess.com: maps result from the profile point of view', () => {
    const raw = { pgn, rules: 'chess', url: 'https://www.chess.com/game/live/1', time_class: 'rapid', rated: true, end_time: 5,
      white: { username: 'Me', rating: 500, result: 'win' }, black: { username: 'Foe', rating: 600, result: 'resigned' } };
    expect(normalizeChessCom(raw, 'me')).toMatchObject({ color: 'w', result: 'W', ext_id: '1' });
    expect(normalizeChessCom(raw, 'foe')).toMatchObject({ color: 'b', result: 'L' });
    expect(normalizeChessCom({ ...raw, rules: 'chess960' }, 'me')).toBeNull();
    expect(normalizeChessCom(raw, 'nobody')).toBeNull();
  });
  it('lichess: draws and variants', () => {
    const raw = { id: 'abc', pgn, variant: 'standard', speed: 'classical', rated: true, createdAt: 1000, lastMoveAt: 2000,
      players: { white: { user: { name: 'Me' }, rating: 1500 }, black: { user: { name: 'Foe' }, rating: 1400 } } };
    expect(normalizeLichess(raw, 'Me')).toMatchObject({ color: 'w', result: 'D', time_class: 'rapid' });
    expect(normalizeLichess({ ...raw, winner: 'black' }, 'Me')).toMatchObject({ result: 'L' });
    expect(normalizeLichess({ ...raw, variant: 'atomic' }, 'Me')).toBeNull();
  });
});
