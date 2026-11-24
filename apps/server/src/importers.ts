import { db, tx } from './db.js';
import { parseGame } from './pgn.js';
import { detectOpening } from './openings.js';

const UA = 'ChessAnalysisStudio/0.1 (self-hosted study tool)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, accept = 'application/json'): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  throw new Error('rate limited: ' + url);
}

const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export interface NormalizedGame {
  provider: 'chesscom' | 'lichess';
  ext_id: string;
  url: string;
  username: string;
  color: 'w' | 'b';
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: 'W' | 'D' | 'L';
  termination: string;
  time_class: string;
  time_control: string;
  rated: number;
  played_at: number;
  pgn: string;
}

const insertStmt = () =>
  db.prepare(`INSERT OR IGNORE INTO games
  (profile_id, provider, ext_id, url, username, color, white, black, white_rating, black_rating, result, termination,
   time_class, time_control, rated, played_at, eco, opening, book_plies, plies, pgn, moves_uci, clocks, status, priority)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`);

/** Insert a normalized game; returns true when it was new. */
export function saveGame(profileId: number, g: NormalizedGame): boolean {
  const parsed = parseGame(g.pgn);
  if (!parsed || parsed.movesUci.length < 2) return false;
  const op = detectOpening(parsed.movesUci);
  const priority = g.time_class === 'rapid' ? 2 : g.time_class === 'classical' ? 2 : g.time_class === 'blitz' ? 1 : 0;
  const r = insertStmt().run(
    profileId, g.provider, g.ext_id, g.url, g.username, g.color, g.white, g.black, g.white_rating, g.black_rating,
    g.result, g.termination, g.time_class, g.time_control, g.rated, g.played_at, op.eco, op.name, op.bookPlies,
    parsed.movesUci.length, g.pgn, JSON.stringify(parsed.movesUci), parsed.clocks.length ? JSON.stringify(parsed.clocks) : null,
    priority,
  );
  return Number(r.changes) > 0;
}

// ---------------------------------------------------------------- chess.com
export function normalizeChessCom(raw: any, username: string): NormalizedGame | null {
  if (!raw?.pgn || raw.rules !== 'chess') return null;
  const u = username.toLowerCase();
  const wn = String(raw.white?.username ?? '');
  const bn = String(raw.black?.username ?? '');
  const color = wn.toLowerCase() === u ? 'w' : bn.toLowerCase() === u ? 'b' : null;
  if (!color) return null;
  const mine = color === 'w' ? raw.white : raw.black;
  const theirs = color === 'w' ? raw.black : raw.white;
  const result: 'W' | 'D' | 'L' = mine.result === 'win' ? 'W' : DRAW_RESULTS.has(mine.result) ? 'D' : theirs.result === 'win' ? 'L' : 'D';
  const url: string = raw.url ?? '';
  return {
    provider: 'chesscom',
    ext_id: url.split('/').pop() ?? String(raw.uuid),
    url,
    username,
    color,
    white: wn,
    black: bn,
    white_rating: raw.white?.rating ?? null,
    black_rating: raw.black?.rating ?? null,
    result,
    termination: result === 'W' ? theirs.result : mine.result,
    time_class: raw.time_class ?? 'unknown',
    time_control: raw.time_control ?? '',
    rated: raw.rated ? 1 : 0,
    played_at: raw.end_time ?? 0,
    pgn: raw.pgn,
  };
}

export async function syncChessCom(
  profileId: number,
  username: string,
  onProgress?: (msg: string) => void,
): Promise<{ added: number; seen: number }> {
  const idx = await getJson(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
  if (!idx) throw new Error(`حساب chess.com غير موجود: ${username}`);
  const archives: string[] = idx.archives ?? [];
  const acc = db.prepare('SELECT last_sync FROM accounts WHERE profile_id=? AND provider=? AND username=?').get(profileId, 'chesscom', username) as any;
  // Re-fetch from the month before the last sync (games can finish late) onwards.
  let todo = archives;
  if (acc?.last_sync) {
    const d = new Date(acc.last_sync * 1000);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const from = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    todo = archives.filter((a) => a.split('/').slice(-2).join('/') >= from);
  }
  let added = 0, seen = 0;
  for (let i = 0; i < todo.length; i++) {
    onProgress?.(`chess.com ${todo[i].split('/').slice(-2).join('/')} (${i + 1}/${todo.length})`);
    const data = await getJson(todo[i]);
    const games: any[] = data?.games ?? [];
    tx(() => {
      for (const raw of games) {
        const g = normalizeChessCom(raw, username);
        if (!g) continue;
        seen++;
        if (saveGame(profileId, g)) added++;
      }
    });
    await sleep(150);
  }
  db.prepare('UPDATE accounts SET last_sync=? WHERE profile_id=? AND provider=? AND username=?').run(Math.floor(Date.now() / 1000), profileId, 'chesscom', username);
  return { added, seen };
}

export async function fetchChessComRatings(username: string): Promise<Record<string, number>> {
  const s = await getJson(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/stats`);
  const out: Record<string, number> = {};
  for (const k of ['rapid', 'blitz', 'bullet', 'daily']) {
    const r = s?.[`chess_${k}`]?.last?.rating;
    if (typeof r === 'number') out[k] = r;
  }
  const t = s?.tactics?.highest?.rating;
  if (typeof t === 'number') out.tactics = t;
  return out;
}

// ------------------------------------------------------------------ lichess
const LI_SPEED: Record<string, string> = {
  ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'rapid', correspondence: 'daily',
};

export function normalizeLichess(raw: any, username: string): NormalizedGame | null {
  if (!raw?.pgn || (raw.variant && raw.variant !== 'standard')) return null;
  const u = username.toLowerCase();
  const bn = String(raw.players?.black?.user?.name ?? (raw.players?.black?.aiLevel ? 'AI' : 'anon'));
  const wReal = String(raw.players?.white?.user?.name ?? (raw.players?.white?.aiLevel ? 'AI' : 'anon'));
  const color = wReal.toLowerCase() === u ? 'w' : bn.toLowerCase() === u ? 'b' : null;
  if (!color) return null;
  const result: 'W' | 'D' | 'L' = !raw.winner ? 'D' : (raw.winner === 'white') === (color === 'w') ? 'W' : 'L';
  const clock = raw.clock ? `${raw.clock.initial}+${raw.clock.increment}` : '';
  return {
    provider: 'lichess',
    ext_id: raw.id,
    url: `https://lichess.org/${raw.id}`,
    username,
    color,
    white: wReal,
    black: bn,
    white_rating: raw.players?.white?.rating ?? null,
    black_rating: raw.players?.black?.rating ?? null,
    result,
    termination: raw.status ?? '',
    time_class: LI_SPEED[raw.speed] ?? 'unknown',
    time_control: clock,
    rated: raw.rated ? 1 : 0,
    played_at: Math.floor((raw.lastMoveAt ?? raw.createdAt ?? 0) / 1000),
    pgn: raw.pgn,
  };
}

export async function syncLichess(
  profileId: number,
  username: string,
  onProgress?: (msg: string) => void,
  max?: number,
): Promise<{ added: number; seen: number }> {
  const acc = db.prepare('SELECT last_sync FROM accounts WHERE profile_id=? AND provider=? AND username=?').get(profileId, 'lichess', username) as any;
  const since = acc?.last_sync ? (acc.last_sync - 86400) * 1000 : 0;
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?since=${since}&pgnInJson=true&clocks=true&opening=true&moves=true&tags=true${max ? `&max=${max}` : ''}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`حساب lichess غير موجود: ${username}`);
  if (!res.ok || !res.body) throw new Error(`lichess HTTP ${res.status}`);
  let added = 0, seen = 0, buf = '';
  const decoder = new TextDecoder();
  const flush = (line: string) => {
    if (!line.trim()) return;
    const g = normalizeLichess(JSON.parse(line), username);
    if (!g) return;
    seen++;
    if (saveGame(profileId, g)) added++;
    if (seen % 100 === 0) onProgress?.(`lichess ${seen} مباراة…`);
  };
  for await (const chunk of res.body as any) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      flush(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  flush(buf);
  db.prepare('UPDATE accounts SET last_sync=? WHERE profile_id=? AND provider=? AND username=?').run(Math.floor(Date.now() / 1000), profileId, 'lichess', username);
  return { added, seen };
}
