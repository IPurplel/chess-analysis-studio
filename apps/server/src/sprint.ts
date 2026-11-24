import { db } from './db.js';
import { overview } from './stats.js';

export interface SprintSettings { contestDate: string; target: number; minutes: number; }
export interface Task { id: string; type: string; minutes: number; count?: number; theme?: string; opponentElo?: number; ref?: string; }
export interface SprintDay { date: string; isToday: boolean; isContest: boolean; tasks: Task[]; }

export const DEFAULT_SPRINT: SprintSettings = { contestDate: '', target: 1200, minutes: 60 };

export function getSetting(profileId: number, key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE profile_id=? AND key=?').get(profileId, key) as any)?.value ?? null;
}
export function setSetting(profileId: number, key: string, value: string) {
  db.prepare('INSERT INTO settings(profile_id,key,value) VALUES (?,?,?) ON CONFLICT(profile_id,key) DO UPDATE SET value=excluded.value').run(profileId, key, value);
}
export function readSprint(profileId: number): SprintSettings {
  try { return { ...DEFAULT_SPRINT, ...JSON.parse(getSetting(profileId, 'sprint') ?? '{}') }; } catch { return { ...DEFAULT_SPRINT }; }
}

/** Which puzzle themes train the mistakes this player actually makes. */
const KIND_THEMES: Record<string, string[]> = {
  'hangs-piece': ['hangingPiece', 'trappedPiece'],
  'allows-tactic': ['fork', 'pin', 'hangingPiece'],
  'allows-mate': ['mateIn1', 'backRankMate'],
  'missed-mate': ['mateIn2', 'mateIn1'],
  'missed-material': ['fork', 'pin', 'skewer'],
  positional: ['advancedPawn', 'defensiveMove'],
};

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export function buildSprint(profileId: number, s: SprintSettings, rating: number | null) {
  const o = overview(profileId, { tc: 'rapid' });
  const kinds = Object.entries(o.insights.kinds).sort((a, b) => b[1] - a[1]);
  const themes: string[] = [];
  for (const [k] of kinds) for (const t of KIND_THEMES[k] ?? []) if (!themes.includes(t)) themes.push(t);
  if (!themes.length) themes.push('hangingPiece', 'mateIn1', 'fork');
  const worstPhase = Object.entries(o.insights.phaseDetail).sort((a, b) => b[1].blundersPer100 - a[1].blundersPer100)[0]?.[0] ?? 'middlegame';
  const myElo = rating ?? 600;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const end = s.contestDate ? new Date(s.contestDate + 'T00:00:00Z') : null;
  const days: SprintDay[] = [];
  const span = end ? Math.max(1, Math.min(14, Math.round((+end - +today) / 86400000) + 1)) : 3;
  const per = Math.max(20, s.minutes);

  for (let i = 0; i < span; i++) {
    const d = new Date(+today + i * 86400000);
    const date = dayStr(d);
    const isContest = !!end && date === dayStr(end);
    const t: Task[] = [];
    if (isContest) {
      t.push({ id: 'warmup', type: 'puzzles', minutes: 10, count: 8, theme: themes[0] });
      t.push({ id: 'checklist', type: 'habit', minutes: 3 });
      t.push({ id: 'rest', type: 'rest', minutes: 0 });
    } else {
      const th = themes[i % themes.length];
      t.push({ id: 'puz-a', type: 'puzzles', minutes: Math.round(per * 0.3), count: Math.max(8, Math.round(per * 0.3 / 1.5)), theme: th });
      t.push({ id: 'mine', type: 'my-mistakes', minutes: Math.round(per * 0.15), count: 8 });
      t.push({ id: 'game', type: 'play-bot', minutes: Math.round(per * 0.35), opponentElo: Math.round((myElo + 100) / 100) * 100, ref: 'review-after' });
      t.push(i % 2 === 0
        ? { id: 'open', type: 'opening', minutes: Math.round(per * 0.1), ref: 'trainer' }
        : { id: 'end', type: 'endgame', minutes: Math.round(per * 0.1), ref: 'endgames' });
      t.push({ id: 'checklist', type: 'habit', minutes: 3 });
    }
    days.push({ date, isToday: i === 0, isContest, tasks: t });
  }

  const blundersPerGame = o.totals.blunderPerGame;
  // returned as a key + params so the web app can show it in the selected language
  const honest = rating && s.target - rating > 150
    ? { key: 'sp.honest.gap', params: { from: rating, to: s.target, days: span, now: blundersPerGame.toFixed(1), goal: Math.max(0.8, blundersPerGame / 2).toFixed(1) } }
    : { key: 'sp.honest.ok', params: {} };
  return { days, focus: { themes, worstPhase, kinds: Object.fromEntries(kinds) }, honest };
}
