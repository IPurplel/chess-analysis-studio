import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;
let dir: string;

async function call(path: string, cookie = '', body?: unknown, method?: string) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  const setCookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { status: res.status, json, cookie: setCookie, headers: res.headers };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-test-'));
  proc = spawn(process.execPath, [join(process.cwd(), '../../node_modules/tsx/dist/cli.mjs'), 'src/main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DB_FILE: join(dir, 't.sqlite'), NO_ENGINE: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('test server did not start');
}, 30000);

afterAll(() => {
  proc?.kill();
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 500);
});

describe('API security and isolation', () => {
  let a = '', b = '';
  it('requires a session', async () => {
    expect((await call('/api/games')).status).toBe(401);
    expect((await call('/api/stats')).status).toBe(401);
    for (const p of ['/api/sprint', '/api/trainer', '/api/lib-puzzles/next', '/api/training/summary', '/api/library/status']) {
      expect((await call(p)).status).toBe(401);
    }
  });
  it('validates sprint input and serves trainer data to a signed-in profile', async () => {
    const r = await call('/api/profiles', '', { name: 'Gamma' });
    const c = r.cookie;
    expect((await call('/api/sprint', c, { contestDate: 'tomorrow' }, 'PUT')).status).toBe(400);
    expect((await call('/api/sprint', c, { contestDate: '2026-11-27', target: 1200, minutes: 45 }, 'PUT')).status).toBe(200);
    const s = await call('/api/sprint', c);
    expect(s.json.settings.contestDate).toBe('2026-11-27');
    expect(s.json.plan.days.length).toBeGreaterThan(0);
    const tr = await call('/api/trainer', c);
    expect(tr.json.families.length).toBeGreaterThanOrEqual(10);
    expect((await call('/api/trainer/result', c, { family: 'nope', line: 'x', role: 'owner', mistakes: 0 })).status).toBe(400);
    expect((await call('/api/lib-puzzles/nope/attempt', c, { solved: true })).status).toBe(404);
  });
  it('sends hardening headers', async () => {
    const r = await call('/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
  it('validates names and PINs', async () => {
    expect((await call('/api/profiles', '', { name: 'x' })).status).toBe(400);
    expect((await call('/api/profiles', '', { name: 'Okname', pin: 'abc' })).status).toBe(400);
  });
  it('keeps two profiles separate', async () => {
    const ra = await call('/api/profiles', '', { name: 'Alpha', pin: '1234' });
    const rb = await call('/api/profiles', '', { name: 'Beta' });
    expect(ra.status).toBe(200); expect(rb.status).toBe(200);
    a = ra.cookie; b = rb.cookie;
    expect(a).toMatch(/^sid=/); expect(a).not.toBe(b);

    // put one game into Alpha's account directly in the database
    const db = new DatabaseSync(join(dir, 't.sqlite'));
    const pid = (db.prepare("SELECT id FROM profiles WHERE name='Alpha'").get() as any).id;
    db.prepare(`INSERT INTO games(profile_id,provider,ext_id,username,color,result,time_class,played_at,pgn,moves_uci,plies)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(pid, 'chesscom', 'g1', 'alpha', 'w', 'W', 'rapid', 1, '[Event "x"]', '["e2e4"]', 1);
    const gid = (db.prepare('SELECT id FROM games').get() as any).id;
    db.close();

    expect((await call('/api/games?tc=all', a)).json.games).toHaveLength(1);
    expect((await call('/api/games?tc=all', b)).json.games).toHaveLength(0);
    expect((await call(`/api/games/${gid}`, a)).status).toBe(200);
    expect((await call(`/api/games/${gid}`, b)).status).toBe(404);
    expect((await call(`/api/games/${gid}/analyse`, b, {})).status).toBe(200); // no-op for another profile
    expect((await call('/api/stats?tc=all', b)).json.totals.games).toBe(0);
  });
  it('deletes a profile with all its data, but only with the right PIN', async () => {
    const r = await call('/api/profiles', '', { name: 'Doomed', pin: '4321' });
    const c = r.cookie;
    expect((await call('/api/profile', c, { pin: '0000' }, 'DELETE')).status).toBe(403);
    expect((await call('/api/profile', c, { pin: '4321' }, 'DELETE')).status).toBe(200);
    expect((await call('/api/login', '', { name: 'Doomed', pin: '4321' })).status).toBe(404);
    expect((await call('/api/me', c)).status).toBe(401);
  });
  it('saves a bot game for review, only for its owner, and validates it', async () => {
    const r = await call('/api/profiles', '', { name: 'Botty' });
    const c = r.cookie;
    expect((await call('/api/games/bot', c, { moves: ['e2e4'], color: 'w', elo: 800 })).status).toBe(400);
    expect((await call('/api/games/bot', c, { moves: ['e2e4', 'e2e4'], color: 'w', elo: 800 })).status).toBe(400); // illegal
    const ok = await call('/api/games/bot', c, { moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], color: 'b', elo: 1100 });
    expect(ok.status).toBe(200);
    const g = await call(`/api/games/${ok.json.id}`, c);
    expect(g.json.game).toMatchObject({ provider: 'bot', color: 'b', time_class: 'bot' });
    expect(g.json.game.moves).toHaveLength(4);
    expect((await call(`/api/games/${ok.json.id}`, '')).status).toBe(401);
  });
  it('judge needs an engine and a legal request; puzzle sets wait for the library', async () => {
    const r = await call('/api/profiles', '', { name: 'Judy' });
    const c = r.cookie;
    expect((await call('/api/judge', c, { fen: 'nope', uci: 'e2e4' })).status).toBe(400);
    expect((await call('/api/judge', c, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', uci: 'e2e4' })).status).toBe(503);
    expect((await call('/api/sets/current', c)).json.ready).toBe(false);
  });
  it('rejects a bad FEN before it can reach the engine', async () => {
    expect((await call('/api/bot/move', b, { fen: 'not a fen', elo: 800 })).status).toBe(400);
  });
  it('locks PIN guessing after repeated failures', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call('/api/login', '', { name: 'Alpha', pin: '0000' })).status;
    expect(last).toBe(429);
  });
});
