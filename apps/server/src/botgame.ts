import { Chess } from 'chess.js';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { detectOpening } from './openings.js';

export interface BotGameInput { moves: string[]; startFen?: string | null; color: 'w' | 'b'; elo: number; resigned?: boolean }

/** Store a game played against the engine so it can be analysed and reviewed like any other game. */
export function saveBotGame(profileId: number, profileName: string, g: BotGameInput): number {
  const start = g.startFen && g.startFen !== new Chess().fen() ? g.startFen : null;
  const c = start ? new Chess(start) : new Chess();
  if (!Array.isArray(g.moves) || g.moves.length < 2 || g.moves.length > 600) throw new Error('game too short or too long');
  for (const u of g.moves) {
    if (typeof u !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) throw new Error('bad move');
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  }
  let result: 'W' | 'D' | 'L' = 'D';
  let termination = 'unfinished';
  if (c.isCheckmate()) { result = c.turn() !== g.color ? 'W' : 'L'; termination = 'checkmate'; }
  else if (c.isDraw() || c.isStalemate()) { result = 'D'; termination = 'draw'; }
  else if (g.resigned) { result = 'L'; termination = 'resigned'; }

  const names = g.color === 'w' ? [profileName, `Bot ~${g.elo}`] : [`Bot ~${g.elo}`, profileName];
  const pgnGame = start ? new Chess(start) : new Chess();
  for (const u of g.moves) pgnGame.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  pgnGame.header('Event', 'Practice game vs bot', 'White', names[0], 'Black', names[1], 'Result', result === 'D' ? '1/2-1/2' : (result === 'W') === (g.color === 'w') ? '1-0' : '0-1');
  const op = start ? { eco: '', name: '', bookPlies: 0 } : detectOpening(g.moves);
  const botElo = Math.round(g.elo);
  const r = db.prepare(`INSERT INTO games
    (profile_id, provider, ext_id, url, username, color, white, black, white_rating, black_rating, result, termination, time_class, time_control, rated,
     played_at, eco, opening, book_plies, plies, pgn, moves_uci, clocks, status, priority, start_fen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 100, ?)`).run(
    profileId, 'bot', randomUUID(), '', profileName, g.color, names[0], names[1],
    g.color === 'w' ? null : botElo, g.color === 'w' ? botElo : null, result, termination, 'bot', '', 0,
    Math.floor(Date.now() / 1000), op.eco, op.name, op.bookPlies, g.moves.length, pgnGame.pgn(), JSON.stringify(g.moves), null, start);
  return Number(r.lastInsertRowid);
}
