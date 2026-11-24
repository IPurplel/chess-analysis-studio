import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface RawLine { id: string; name: string; san: string; idea: string }
export interface RawFamily { id: string; name: string; owner: 'w' | 'b'; start: string; idea: string; lines: RawLine[] }
export interface Line { id: string; name: string; idea: string; san: string[]; uci: string[] }
export interface Family { id: string; name: string; owner: 'w' | 'b'; start: string; idea: string; lines: Line[] }

const FILE = process.env.COUNTERS_FILE ?? fileURLToPath(new URL('../../../data/counters.json', import.meta.url));
let cache: { note: string; families: Family[] } | null = null;

/** Replay a SAN list and return UCI moves; throws on any illegal move so bad data is caught by tests. */
export function toUci(san: string[]): string[] {
  const c = new Chess();
  return san.map((s) => {
    const m = c.move(s);
    return m.from + m.to + (m.promotion ?? '');
  });
}

export function loadTrainer() {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { note: string; families: RawFamily[] };
  cache = {
    note: raw.note,
    families: raw.families.map((f) => ({
      ...f,
      lines: f.lines.map((l) => {
        const san = l.san.split(/\s+/);
        return { id: l.id, name: l.name, idea: l.idea, san, uci: toUci(san) };
      }),
    })),
  };
  return cache;
}
