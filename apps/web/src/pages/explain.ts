import { Chess, type Square } from 'chess.js';
import { t } from '../i18n';

const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);
const NEAR_CENTER = new Set(['c3', 'c4', 'c5', 'c6', 'd3', 'd6', 'e3', 'e6', 'f3', 'f4', 'f5', 'f6']);
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const piece = (p: string) => t('piece.' + p);

/** Squares holding a piece for a colour, with the piece type. */
function pieces(c: Chess, color: 'w' | 'b') {
  const out: { sq: Square; type: string }[] = [];
  for (const row of c.board()) for (const s of row) if (s && s.color === color) out.push({ sq: s.square, type: s.type });
  return out;
}

/**
 * What a move does, in learner terms, built from the position itself: its purpose (develop, take the centre,
 * castle...), what it now attacks or protects, which centre squares it watches and whether it opens lines.
 */
export function explainMove(fenBefore: string, uci: string, prevUci?: string): string {
  const c = new Chess(fenBefore);
  const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const after = new Chess(c.fen());
  const parts: string[] = [];
  const backRank = m.color === 'w' ? '1' : '8';
  const foe = m.color === 'w' ? 'b' : 'w';

  // 1. purpose
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
    if ((m.from[0] === 'e' || m.from[0] === 'd') && (m.from[1] === '2' || m.from[1] === '7')) parts.push(t('exp.opensLines'));
  } else if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank) {
    parts.push(t('exp.develop', { piece: piece(m.piece), sq: m.to }));
  } else if (m.piece === 'q') parts.push(t('exp.queen', { sq: m.to }));
  else if (m.piece === 'r') parts.push(t('exp.rook', { sq: m.to }));
  else parts.push(t('exp.move', { piece: piece(m.piece), sq: m.to }));

  if (m.san.startsWith('O-O')) return parts.join(' ');

  // 2. what the moved piece now does (computed with chess.js attack maps)
  const to = m.to as Square;
  const attacked = pieces(after, foe)
    .filter((p) => p.type !== 'k' && after.attackers(p.sq, m.color).includes(to))
    .map((p) => ({ ...p, defended: after.attackers(p.sq, foe).length > 0 }))
    .sort((a, b) => VALUE[b.type] - VALUE[a.type]);
  for (const a of attacked.slice(0, 2)) {
    const winning = !a.defended || VALUE[a.type] > VALUE[m.piece];
    parts.push(t(winning ? 'exp.threat' : 'exp.attacks', { piece: piece(a.type), sq: a.sq }));
  }
  const protectedPieces = pieces(after, m.color)
    .filter((p) => p.sq !== to && p.type !== 'k' && after.attackers(p.sq, m.color).includes(to))
    .sort((a, b) => VALUE[b.type] - VALUE[a.type]);
  if (!m.captured && protectedPieces[0]) parts.push(t('exp.protects', { piece: piece(protectedPieces[0].type), sq: protectedPieces[0].sq }));
  if (m.piece !== 'p') {
    const watched = ['d4', 'e4', 'd5', 'e5'].filter((s) => after.attackers(s as Square, m.color).includes(to));
    if (watched.length) parts.push(t('exp.controls', { sqs: watched.join(' ') }));
  }
  if (after.inCheck()) parts.push(t('exp.check'));
  return parts.join(' ');
}

/** Convert the first `n` moves of an engine line (UCI) to SAN starting from `fen`. */
export function pvToSan(fen: string, pv: string[], n = 6): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  return out;
}
