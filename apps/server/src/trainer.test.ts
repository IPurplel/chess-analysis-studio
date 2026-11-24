import { describe, expect, it } from 'vitest';
import { loadTrainer } from './trainer.js';

describe('opening trainer data', () => {
  it('every curated line is legal and has the right owner for its first move', () => {
    const t = loadTrainer(); // throws on an illegal move
    expect(t.families.length).toBeGreaterThanOrEqual(10);
    for (const f of t.families) {
      expect(f.lines.length).toBeGreaterThan(0);
      for (const l of f.lines) {
        expect(l.uci.length).toBeGreaterThanOrEqual(8);
        expect(new Set(l.san).size).toBeGreaterThan(4);
      }
    }
  });
  it('every opening and scenario has a written guide (plan, mistakes, what to watch)', () => {
    for (const f of loadTrainer().families) {
      expect(f.summary, f.id).toBeTruthy();
      expect(f.category, f.id).toBeTruthy();
      expect((f.plans?.w?.length ?? 0) + (f.plans?.b?.length ?? 0), f.id).toBeGreaterThan(2);
      expect(f.mistakes?.length, f.id).toBeGreaterThan(1);
      for (const l of f.lines) {
        expect(l.plan, f.id + '/' + l.id).toBeTruthy();
        expect(l.watch, f.id + '/' + l.id).toBeTruthy();
      }
    }
  });
  it('hand-written notes, where present, line up with the moves', () => {
    let withNotes = 0;
    for (const f of loadTrainer().families) for (const l of f.lines as any[]) {
      if (!l.notes) continue;
      withNotes++;
      expect(l.notes.length, f.id + '/' + l.id).toBe(l.san.length);
    }
    expect(withNotes).toBeGreaterThanOrEqual(8); // the Sicilian lines
  });
  it('line ids are unique inside a family', () => {
    for (const f of loadTrainer().families) expect(new Set(f.lines.map((l) => l.id)).size).toBe(f.lines.length);
  });
});
