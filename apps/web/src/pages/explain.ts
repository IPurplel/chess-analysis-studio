import { Chess } from 'chess.js';
import { t } from '../i18n';

const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);
const NEAR_CENTER = new Set(['c3', 'c4', 'c5', 'c6', 'd3', 'd6', 'e3', 'e6', 'f3', 'f4', 'f5', 'f6']);
const piece = (p: string) => t('piece.' + p);

/**
 * A short, automatic explanation of one move (what it does, in learner terms).
 * It is generated from the move itself, so it describes purpose, not theory; curated notes can sit on top.
 */
export function explainMove(fenBefore: string, uci: string, prevUci?: string): string {
  const c = new Chess(fenBefore);
  const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const after = new Chess(c.fen());
  const parts: string[] = [];
  const backRank = m.color === 'w' ? '1' : '8';

  if (m.san.startsWith('O-O')) {
    parts.push(t(m.san.startsWith('O-O-O') ? 'exp.castleLong' : 'exp.castle'));
  } else if (m.captured) {
    const recapture = prevUci && prevUci.slice(2, 4) === m.to;
    parts.push(t(recapture ? 'exp.recapture' : 'exp.capture', { piece: piece(m.piece), target: piece(m.captured), sq: m.to }));
  } else if (m.piece === 'p') {
    if (CENTER.has(m.to)) parts.push(t('exp.pawnCenter', { sq: m.to }));
    else if (['b3', 'b6', 'g3', 'g6'].includes(m.to)) parts.push(t('exp.fianchetto', { sq: m.to }));
    else if (NEAR_CENTER.has(m.to)) parts.push(t('exp.pawnSupport', { sq: m.to }));
    else parts.push(t('exp.pawnFlank', { sq: m.to }));
  } else if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank) {
    parts.push(t('exp.develop', { piece: piece(m.piece), sq: m.to }));
    if (CENTER.has(m.to) || NEAR_CENTER.has(m.to)) parts.push(t('exp.eyesCenter'));
  } else if (m.piece === 'q') parts.push(t('exp.queen', { sq: m.to }));
  else if (m.piece === 'r') parts.push(t('exp.rook', { sq: m.to }));
  else parts.push(t('exp.move', { piece: piece(m.piece), sq: m.to }));

  if (after.inCheck()) parts.push(t('exp.check'));
  return parts.join(' ');
}
