import { Chess } from 'chess.js';
import { readFileSync, existsSync } from 'node:fs';
import { DATA_DIR } from './db.js';

export interface OpeningEntry {
  eco: string;
  name: string;
}

const key = (fen: string) => fen.split(' ').slice(0, 3).join(' '); // placement, turn, castling
let book: Map<string, OpeningEntry> | null = null;

function load(): Map<string, OpeningEntry> {
  if (book) return book;
  book = new Map();
  for (const f of ['a', 'b', 'c', 'd', 'e']) {
    const path = `${process.env.OPENINGS_DIR ?? DATA_DIR + '/openings'}/${f}.tsv`;
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).slice(1);
    for (const line of lines) {
      const [eco, name, pgn] = line.split('\t');
      if (!eco || !pgn) continue;
      const c = new Chess();
      try {
        c.loadPgn(pgn);
      } catch {
        continue;
      }
      // Later entries are more specific; keep whichever is registered last for a position.
      book.set(key(c.fen()), { eco, name });
    }
  }
  return book;
}

export function openingsLoaded(): number {
  return load().size;
}

/** Opening reached by a game and how many plies were still "theory". */
export function detectOpening(movesUci: string[]): { eco: string; name: string; bookPlies: number } {
  const b = load();
  const c = new Chess();
  let found: OpeningEntry | null = null;
  let bookPlies = 0;
  for (let i = 0; i < Math.min(movesUci.length, 40); i++) {
    const u = movesUci[i];
    try {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    } catch {
      break;
    }
    const e = b.get(key(c.fen()));
    if (e) {
      found = e;
      bookPlies = i + 1;
    }
  }
  return found ? { ...found, bookPlies } : { eco: '', name: 'غير مصنّفة', bookPlies: 0 };
}

/** Family name: "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense". */
export const openingFamily = (name: string) => name.split(':')[0].trim();
