import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { fetchChessComRatings, syncChessCom, syncLichess } from './importers.js';
import { gameList, overview } from './stats.js';
import { buildCoach } from './coach.js';
import { kick, queueStats, rereviewOutdated, startWorker } from './analysis.js';
import { openingsLoaded } from './openings.js';
import { botMove } from './bot.js';
import { buildSprint, getSetting, readSprint, setSetting } from './sprint.js';
import { loadTrainer } from './trainer.js';
import { judgeMove } from './judge.js';
import { saveBotGame } from './botgame.js';
import { currentSetId, markSetItem, setItemPuzzle, setOverview } from './sets.js';
import { EngineUnavailable } from './analysis.js';
import { ensureLibrary, importLibrary, libState, libraryCount, nextLibraryPuzzle, puzzleRating, recordAttempt, streak, themeStats } from './library.js';
import { Chess } from 'chess.js';

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 });
await app.register(cookie);

// ------------------------------------------------------------------ hardening
// Behind HTTPS (reverse proxy) set COOKIE_SECURE=1 so the session cookie is never sent over plain HTTP.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_TTL = 60 * 60 * 24 * 90; // seconds
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  );
});

/** Tiny in-memory limiter: at most `max` hits per `windowMs` for a key. */
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
  return arr.length > max;
}

// ------------------------------------------------------------------ auth (per-browser profile sessions)
const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');
const now = () => Math.floor(Date.now() / 1000);

function profileOf(req: any): { id: number; name: string } | null {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  return (db.prepare('SELECT p.id, p.name FROM sessions s JOIN profiles p ON p.id = s.profile_id WHERE s.sid = ? AND s.created_at > ?').get(sid, now() - SESSION_TTL) as any) ?? null;
}
function startSession(reply: any, profileId: number) {
  const sid = randomBytes(24).toString('hex');
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(now() - SESSION_TTL);
  db.prepare('INSERT INTO sessions(sid, profile_id, created_at) VALUES (?,?,?)').run(sid, profileId, now());
  reply.setCookie('sid', sid, { path: '/', httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: SESSION_TTL });
}
app.addHook('preHandler', async (req, reply) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/') || ['/api/profiles', '/api/login', '/api/health'].includes(url)) return;
  const p = profileOf(req);
  if (!p) return reply.code(401).send({ error: 'login required' });
  (req as any).profile = p;
});

app.get('/api/health', async () => ({ ok: true, openings: openingsLoaded(), queue: queueStats() }));

app.get('/api/profiles', async () => ({
  profiles: (db.prepare('SELECT name, pin_hash IS NOT NULL AS has_pin FROM profiles ORDER BY name').all() as any[]).map((p) => ({ name: p.name, hasPin: !!p.has_pin })),
}));

app.post('/api/profiles', async (req, reply) => {
  const { name, pin } = (req.body ?? {}) as { name?: string; pin?: string };
  const n = String(name ?? '').trim();
  if (limited('create:' + req.ip, 10, 60 * 60_000)) return reply.code(429).send({ error: 'محاولات كثيرة، حاول لاحقًا' });
  if (!/^[\p{L}\p{N}_\- ]{2,24}$/u.test(n)) return reply.code(400).send({ error: 'اسم غير صالح (2–24 حرفًا)' });
  if (pin !== undefined && pin !== '' && !/^\d{4,12}$/.test(String(pin))) return reply.code(400).send({ error: 'الرمز أرقام فقط (4–12)' });
  if (db.prepare('SELECT 1 FROM profiles WHERE name=?').get(n)) return reply.code(409).send({ error: 'الاسم مستخدم' });
  const salt = pin ? randomBytes(16).toString('hex') : null;
  const r = db.prepare('INSERT INTO profiles(name, pin_salt, pin_hash, created_at) VALUES (?,?,?,?)').run(n, salt, pin ? hashPin(String(pin), salt!) : null, now());
  startSession(reply, Number(r.lastInsertRowid));
  return { ok: true };
});

app.post('/api/login', async (req, reply) => {
  const { name, pin } = (req.body ?? {}) as { name?: string; pin?: string };
  const p = db.prepare('SELECT * FROM profiles WHERE name=?').get(String(name ?? '')) as any;
  if (!p) return reply.code(404).send({ error: 'الملف غير موجود' });
  if (p.pin_hash) {
    // brute-force guard: 8 PIN attempts per 10 minutes per client and profile
    if (limited(`pin:${req.ip}:${p.id}`, 8, 10 * 60_000)) return reply.code(429).send({ error: 'محاولات كثيرة، انتظر 10 دقائق' });
    const given = Buffer.from(hashPin(String(pin ?? ''), p.pin_salt), 'hex');
    if (!timingSafeEqual(given, Buffer.from(p.pin_hash, 'hex'))) return reply.code(403).send({ error: 'الرمز غير صحيح' });
  }
  startSession(reply, p.id);
  return { ok: true };
});

/** Delete the signed-in profile and everything it owns (accounts, games, analyses, puzzles, progress). */
app.delete('/api/profile', async (req, reply) => {
  const p = (req as any).profile as { id: number };
  const { pin } = (req.body ?? {}) as { pin?: string };
  const row = db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id) as any;
  if (row?.pin_hash) {
    if (limited(`pin:${req.ip}:${p.id}`, 8, 10 * 60_000)) return reply.code(429).send({ error: 'محاولات كثيرة، انتظر 10 دقائق' });
    const given = Buffer.from(hashPin(String(pin ?? ''), row.pin_salt), 'hex');
    if (!timingSafeEqual(given, Buffer.from(row.pin_hash, 'hex'))) return reply.code(403).send({ error: 'الرمز غير صحيح' });
  }
  db.prepare('DELETE FROM profiles WHERE id=?').run(p.id); // ON DELETE CASCADE removes the rest
  reply.clearCookie('sid', { path: '/' });
  return { ok: true };
});

app.post('/api/logout', async (req, reply) => {
  const sid = (req as any).cookies?.sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
  reply.clearCookie('sid', { path: '/' });
  return { ok: true };
});

// ------------------------------------------------------------------ accounts + sync
const ratingCache = new Map<string, { at: number; v: Record<string, number> }>();
async function ratingsFor(profileId: number) {
  const acc = db.prepare("SELECT username FROM accounts WHERE profile_id=? AND provider='chesscom' LIMIT 1").get(profileId) as any;
  if (!acc) return null;
  const c = ratingCache.get(acc.username);
  if (c && Date.now() - c.at < 10 * 60_000) return c.v;
  try {
    const v = await fetchChessComRatings(acc.username);
    ratingCache.set(acc.username, { at: Date.now(), v });
    const snap = db.prepare('INSERT INTO rating_snapshots(profile_id, provider, time_class, rating, taken_at) VALUES (?,?,?,?,?)');
    for (const [k, r] of Object.entries(v)) if (k !== 'tactics') snap.run(profileId, 'chesscom', k, r, now());
    return v;
  } catch {
    return c?.v ?? null;
  }
}

app.get('/api/me', async (req) => {
  const p = (req as any).profile;
  const accounts = db.prepare('SELECT provider, username, last_sync FROM accounts WHERE profile_id=?').all(p.id);
  // Never let a slow chess.com stats call hold up the whole app: wait briefly, else use the last known ratings.
  const ratings = await Promise.race([
    ratingsFor(p.id),
    new Promise<null>((r) => setTimeout(() => r(null), 2000)),
  ]);
  const hasPin = !!(db.prepare('SELECT pin_hash FROM profiles WHERE id=?').get(p.id) as any)?.pin_hash;
  return { profile: { ...p, hasPin }, accounts, ratings };
});

app.post('/api/accounts', async (req, reply) => {
  const p = (req as any).profile;
  const { provider, username } = (req.body ?? {}) as any;
  if (!['chesscom', 'lichess'].includes(provider) || !/^[A-Za-z0-9_-]{2,32}$/.test(String(username ?? ''))) return reply.code(400).send({ error: 'بيانات غير صالحة' });
  db.prepare('INSERT OR IGNORE INTO accounts(profile_id, provider, username) VALUES (?,?,?)').run(p.id, provider, username);
  return { ok: true };
});

app.delete('/api/accounts/:provider/:username', async (req) => {
  const p = (req as any).profile;
  const { provider, username } = req.params as any;
  db.prepare('DELETE FROM accounts WHERE profile_id=? AND provider=? AND username=?').run(p.id, provider, username);
  return { ok: true };
});

const syncs = new Map<number, { running: boolean; message: string; error?: string; added: number; finishedAt?: number }>();
app.post('/api/sync', async (req) => {
  const p = (req as any).profile;
  if (syncs.get(p.id)?.running) return { started: false };
  const st = { running: true, message: 'بدء المزامنة…', added: 0 } as any;
  syncs.set(p.id, st);
  (async () => {
    try {
      const accs = db.prepare('SELECT provider, username FROM accounts WHERE profile_id=?').all(p.id) as any[];
      if (!accs.length) throw new Error('أضف حساب chess.com أو lichess أولًا');
      for (const a of accs) {
        const fn = a.provider === 'chesscom' ? syncChessCom : syncLichess;
        const r = await fn(p.id, a.username, (m) => (st.message = m));
        st.added += r.added;
      }
      st.message = `تمت المزامنة: ${st.added} مباراة جديدة`;
      kick();
    } catch (e: any) {
      st.error = String(e?.message ?? e);
      st.message = 'فشلت المزامنة';
    } finally {
      st.running = false;
      st.finishedAt = now();
    }
  })();
  return { started: true };
});
app.get('/api/sync/status', async (req) => syncs.get((req as any).profile.id) ?? { running: false, message: '', added: 0 });

// ------------------------------------------------------------------ data
app.get('/api/games', async (req) => {
  const q = req.query as any;
  return { games: gameList((req as any).profile.id, { tc: q.tc, color: q.color }, Math.min(Number(q.limit) || 100, 500), Number(q.offset) || 0) };
});

app.get('/api/games/:id', async (req, reply) => {
  const p = (req as any).profile;
  const g = db.prepare('SELECT * FROM games WHERE id=? AND profile_id=?').get(Number((req.params as any).id), p.id) as any;
  if (!g) return reply.code(404).send({ error: 'not found' });
  const rv = db.prepare('SELECT json FROM reviews WHERE game_id=?').get(g.id) as any;
  const { moves_uci, clocks, ...rest } = g;
  return { game: { ...rest, moves: JSON.parse(moves_uci), clocks: clocks ? JSON.parse(clocks) : null }, review: rv ? JSON.parse(rv.json) : null };
});

app.post('/api/games/:id/analyse', async (req) => {
  const p = (req as any).profile;
  db.prepare("UPDATE games SET status='pending', priority=100 WHERE id=? AND profile_id=? AND status IN ('pending','error','done')").run(Number((req.params as any).id), p.id);
  kick();
  return { ok: true };
});

app.get('/api/stats', async (req) => {
  const q = req.query as any;
  return overview((req as any).profile.id, { tc: q.tc, color: q.color });
});
app.get('/api/analysis/status', async (req) => queueStats((req as any).profile.id));

app.get('/api/coach', async (req) => {
  const p = (req as any).profile;
  const tc = String((req.query as any).tc ?? 'rapid');
  const ratings = await ratingsFor(p.id);
  return buildCoach(p.id, ratings?.[tc] ?? null, tc);
});

app.get('/api/puzzles/next', async (req) => {
  const p = (req as any).profile;
  const row = db.prepare('SELECT * FROM puzzles WHERE profile_id=? AND box<4 AND due_at<=? ORDER BY due_at ASC, id ASC LIMIT 1').get(p.id, now()) as any;
  if (!row) return { puzzle: null };
  const g = db.prepare('SELECT opening, played_at, url FROM games WHERE id=?').get(row.game_id) as any;
  return { puzzle: { id: row.id, fen: row.fen, solution: JSON.parse(row.solution), played: row.played, category: row.category, theme: row.theme, game: g } };
});
const BOX_DAYS = [0, 1, 3, 7, 21];
app.post('/api/puzzles/:id/attempt', async (req) => {
  const p = (req as any).profile;
  const { correct } = (req.body ?? {}) as { correct?: boolean };
  const row = db.prepare('SELECT * FROM puzzles WHERE id=? AND profile_id=?').get(Number((req.params as any).id), p.id) as any;
  if (!row) return { ok: false };
  const box = correct ? Math.min(4, row.box + 1) : 0;
  const due = now() + (correct ? BOX_DAYS[box] * 86400 : 600);
  db.prepare('UPDATE puzzles SET box=?, due_at=?, attempts=attempts+1, solved=solved+? WHERE id=?').run(box, due, correct ? 1 : 0, row.id);
  return { ok: true, box };
});

// ------------------------------------------------------------------ puzzle library + training progress
app.get('/api/library/status', async () => ({ ...libState, count: libraryCount() }));
app.post('/api/library/import', async () => { void importLibrary(); return { started: true }; });

function cachedTactics(profileId: number): number | null {
  const acc = db.prepare("SELECT username FROM accounts WHERE profile_id=? AND provider='chesscom' LIMIT 1").get(profileId) as any;
  return acc ? ratingCache.get(acc.username)?.v.tactics ?? null : null;
}

app.get('/api/lib-puzzles/next', async (req) => {
  const p = (req as any).profile;
  const theme = String((req.query as any).theme ?? '').replace(/[^A-Za-z0-9]/g, '') || undefined;
  const rating = puzzleRating(p.id, cachedTactics(p.id));
  const puzzle = nextLibraryPuzzle(p.id, rating, theme);
  return { puzzle, rating: Math.round(rating), libraryReady: libraryCount() > 0 };
});

app.post('/api/lib-puzzles/:id/attempt', async (req, reply) => {
  const p = (req as any).profile;
  const { solved, hints, ms, setId } = (req.body ?? {}) as { solved?: boolean; hints?: number; ms?: number; setId?: number };
  const r = recordAttempt(p.id, String((req.params as any).id), !!solved, Math.max(0, Math.min(3, Number(hints) || 0)), Number.isFinite(ms) ? Number(ms) : null);
  if (!r) return reply.code(404).send({ error: 'unknown puzzle' });
  if (setId) markSetItem(p.id, Number(setId), String((req.params as any).id), !!solved);
  return { before: Math.round(r.before), after: Math.round(r.after), streak: streak(p.id) };
});

app.get('/api/training/summary', async (req) => {
  const p = (req as any).profile;
  const today = new Date().toISOString().slice(0, 10);
  const days = db.prepare('SELECT day, puzzles, correct FROM activity WHERE profile_id=? ORDER BY day DESC LIMIT 14').all(p.id);
  return {
    rating: Math.round(puzzleRating(p.id, cachedTactics(p.id))),
    streak: streak(p.id),
    today: (days as any[]).find((d) => d.day === today) ?? { day: today, puzzles: 0, correct: 0 },
    days,
    themes: themeStats(p.id),
    library: { ...libState, count: libraryCount() },
  };
});

// ------------------------------------------------------------------ opening trainer (counters + role swap)
app.get('/api/trainer', async (req) => {
  const p = (req as any).profile;
  const t = loadTrainer();
  const prog = db.prepare('SELECT line_key, role, box, due_at, attempts, clean, mistakes FROM trainer_progress WHERE profile_id=?').all(p.id);
  return { note: t.note, categories: t.categories, principles: t.principles, families: t.families, progress: prog };
});
app.post('/api/trainer/result', async (req, reply) => {
  const p = (req as any).profile;
  const { family, line, role, mistakes } = (req.body ?? {}) as any;
  const f = loadTrainer().families.find((x) => x.id === family);
  if (!f || !f.lines.some((l) => l.id === line) || !['owner', 'counter'].includes(role)) return reply.code(400).send({ error: 'bad request' });
  const key = `${family}/${line}`;
  const m = Math.max(0, Math.min(50, Number(mistakes) || 0));
  const cur = (db.prepare('SELECT * FROM trainer_progress WHERE profile_id=? AND line_key=? AND role=?').get(p.id, key, role) as any) ?? { box: 0 };
  const box = m === 0 ? Math.min(4, cur.box + 1) : 0;
  const due = now() + (m === 0 ? [0, 1, 3, 7, 21][box] * 86400 : 600);
  db.prepare(`INSERT INTO trainer_progress(profile_id,line_key,role,box,due_at,attempts,clean,mistakes) VALUES (?,?,?,?,?,1,?,?)
    ON CONFLICT(profile_id,line_key,role) DO UPDATE SET box=?, due_at=?, attempts=attempts+1, clean=clean+?, mistakes=mistakes+?`)
    .run(p.id, key, role, box, due, m === 0 ? 1 : 0, m, box, due, m === 0 ? 1 : 0, m);
  return { ok: true, box };
});

// ------------------------------------------------------------------ contest sprint
app.get('/api/sprint', async (req) => {
  const p = (req as any).profile;
  const settings = readSprint(p.id);
  const ratings = await Promise.race([ratingsFor(p.id), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  const plan = buildSprint(p.id, settings, ratings?.rapid ?? null);
  const done = JSON.parse(getSetting(p.id, 'sprint_done') ?? '{}') as Record<string, boolean>;
  return { settings, plan, done, rating: ratings?.rapid ?? null };
});
app.put('/api/sprint', async (req, reply) => {
  const p = (req as any).profile;
  const b = (req.body ?? {}) as any;
  const contestDate = String(b.contestDate ?? '');
  if (contestDate && !/^\d{4}-\d{2}-\d{2}$/.test(contestDate)) return reply.code(400).send({ error: 'bad date' });
  const s = { contestDate, target: Math.max(400, Math.min(2500, Number(b.target) || 1200)), minutes: Math.max(15, Math.min(240, Number(b.minutes) || 60)) };
  setSetting(p.id, 'sprint', JSON.stringify(s));
  return { ok: true };
});
app.post('/api/sprint/check', async (req) => {
  const p = (req as any).profile;
  const { key, done } = (req.body ?? {}) as { key?: string; done?: boolean };
  if (!key || !/^\d{4}-\d{2}-\d{2}:[a-z-]+$/.test(key)) return { ok: false };
  const m = JSON.parse(getSetting(p.id, 'sprint_done') ?? '{}');
  if (done) m[key] = true; else delete m[key];
  setSetting(p.id, 'sprint_done', JSON.stringify(m));
  return { ok: true };
});

// ------------------------------------------------------------------ explain a move / save bot games / puzzle sets
app.post('/api/judge', async (req, reply) => {
  const p = (req as any).profile;
  const { fen, uci } = (req.body ?? {}) as { fen?: string; uci?: string };
  if (!fen || fen.length > 120 || !uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return reply.code(400).send({ error: 'bad request' });
  try { new Chess(fen); } catch { return reply.code(400).send({ error: 'bad fen' }); }
  if (limited('judge:' + p.id, 90, 60_000)) return reply.code(429).send({ error: 'slow down' });
  try {
    return await judgeMove(fen, uci);
  } catch (e: any) {
    if (e instanceof EngineUnavailable) return reply.code(503).send({ error: 'engine not ready' });
    return reply.code(400).send({ error: String(e?.message ?? e) });
  }
});

app.post('/api/games/bot', async (req, reply) => {
  const p = (req as any).profile;
  const b = (req.body ?? {}) as any;
  if (limited('botgame:' + p.id, 30, 60 * 60_000)) return reply.code(429).send({ error: 'slow down' });
  try {
    const id = saveBotGame(p.id, p.name, { moves: b.moves, startFen: b.startFen, color: b.color === 'b' ? 'b' : 'w', elo: Number(b.elo) || 1000, resigned: !!b.resigned });
    kick();
    return { id };
  } catch (e: any) {
    return reply.code(400).send({ error: String(e?.message ?? e) });
  }
});

app.get('/api/sets/current', async (req, reply) => {
  const p = (req as any).profile;
  const id = currentSetId(p.id, cachedTactics(p.id));
  if (!id) return { ready: false };
  return { ready: true, ...setOverview(p.id, id) };
});
app.post('/api/sets/new', async (req) => {
  const p = (req as any).profile;
  const id = currentSetId(p.id, cachedTactics(p.id), true);
  return id ? { ready: true, ...setOverview(p.id, id) } : { ready: false };
});
app.get('/api/sets/:id/items/:idx', async (req, reply) => {
  const p = (req as any).profile;
  const { id, idx } = req.params as any;
  const puzzle = setItemPuzzle(p.id, Number(id), Number(idx));
  return puzzle ? { puzzle } : reply.code(404).send({ error: 'not found' });
});

app.post('/api/bot/move', async (req, reply) => {
  const { fen, elo } = (req.body ?? {}) as { fen?: string; elo?: number };
  if (!fen || typeof fen !== 'string' || fen.length > 120) return reply.code(400).send({ error: 'bad fen' });
  // Stockfish 19 terminates on an invalid position, so never forward an unchecked FEN.
  try { new Chess(fen); } catch { return reply.code(400).send({ error: 'bad fen' }); }
  if (limited('bot:' + (req as any).profile.id, 120, 60_000)) return reply.code(429).send({ error: 'slow down' });
  try {
    return { uci: await botMove(fen, Number(elo) || 1000) };
  } catch (e: any) {
    return reply.code(500).send({ error: String(e?.message ?? e) });
  }
});

// ------------------------------------------------------------------ static web app
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: '0.0.0.0' });
console.log(`Chess Analysis Studio on http://0.0.0.0:${port}`);
// after the server is already answering: re-classify stored analyses made with older rules (no engine needed)
rereviewOutdated().then((n) => { if (n) console.log(`re-classified ${n} stored analyses with the current rules`); }).catch((e) => console.error('re-review error', e));
ensureLibrary();
if (process.env.NO_ENGINE !== '1') {
  startWorker().then(() => console.log('engine pool ready')).catch((e) => console.error('engine failed:', e.message));
}
