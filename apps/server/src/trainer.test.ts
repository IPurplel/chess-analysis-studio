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
  it('line ids are unique inside a family', () => {
    for (const f of loadTrainer().families) expect(new Set(f.lines.map((l) => l.id)).size).toBe(f.lines.length);
  });
});
