import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface RawLine { id: string; name: string; san: string; idea: string }
export interface RawFamily { id: string; name: string; owner: 'w' | 'b'; start: string; idea: string; lines: RawLine[] }
export interface Line { id: string; name: string; idea: string; san: string[]; uci: string[]; vs?: string; plan?: string; watch?: string; notes?: string[] }
export interface Family {
  id: string; name: string; owner: 'w' | 'b'; start: string; idea: string; lines: Line[];
  category?: string; level?: string; summary?: string; plans?: { w?: string[]; b?: string[] }; mistakes?: string[];
}
interface Guide {
  categories: Record<string, { name: string; hint: string }>;
  principles: string[];
  families: Record<string, Partial<Family>>;
  lines: Record<string, { vs?: string; plan?: string; watch?: string; notes?: string[] }>;
}

const FILE = process.env.COUNTERS_FILE ?? fileURLToPath(new URL('../../../data/counters.json', import.meta.url));
const GUIDE_FILE = process.env.GUIDE_FILE ?? fileURLToPath(new URL('../../../data/guide.json', import.meta.url));
let cache: { note: string; families: Family[]; categories: Guide['categories']; principles: string[] } | null = null;

/** Replay a SAN list and return UCI moves; throws on any illegal move so bad data is caught by tests. */
export function toUci(san: string[]): string[] {
  const c = new Chess();
  return san.map((s) => {
    const m = c.move(s);
    return m.from + m.to + (m.promotion ?? '');
  });
}

/** Lines (what to play) merged with the written guide (what it is for, plans, mistakes, traps). */
export function loadTrainer() {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { note: string; families: RawFamily[] };
  const guide = JSON.parse(readFileSync(GUIDE_FILE, 'utf8')) as Guide;
  cache = {
    note: raw.note,
    categories: guide.categories,
    principles: guide.principles,
    families: raw.families.map((f) => ({
      ...f,
      ...(guide.families[f.id] ?? {}),
      lines: f.lines.map((l) => {
        const san = l.san.split(/\s+/);
        return { id: l.id, name: l.name, idea: l.idea, san, uci: toUci(san), ...(guide.lines[`${f.id}/${l.id}`] ?? {}) };
      }),
    })),
  };
  return cache;
}
