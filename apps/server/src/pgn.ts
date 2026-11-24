import { Chess } from 'chess.js';

export interface ParsedGame {
  headers: Record<string, string>;
  movesUci: string[];
  clocks: number[]; // seconds remaining after each ply (may be empty)
}

export function parseHeaders(pgn: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"((?:\\.|[^"\\])*)"\]\s*$/gm)) h[m[1]] = m[2].replace(/\\"/g, '"');
  return h;
}

/** Returns null for PGNs chess.js cannot replay (variants, corrupt games). */
export function parseGame(pgn: string): ParsedGame | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const h = parseHeaders(pgn);
  if (h.Variant && h.Variant !== 'Standard') return null;
  const movesUci = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
  const clocks: number[] = [];
  for (const m of pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)) {
    clocks.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  return { headers: h, movesUci, clocks: clocks.length === movesUci.length ? clocks : [] };
}
