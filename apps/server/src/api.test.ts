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
  it('rejects a bad FEN before it can reach the engine', async () => {
    expect((await call('/api/bot/move', b, { fen: 'not a fen', elo: 800 })).status).toBe(400);
  });
  it('locks PIN guessing after repeated failures', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call('/api/login', '', { name: 'Alpha', pin: '0000' })).status;
    expect(last).toBe(429);
  });
});
