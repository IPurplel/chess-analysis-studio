import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL('../../../data', import.meta.url));
const DB_FILE = process.env.DB_FILE ?? `${DATA_DIR}/studio.sqlite`;

mkdirSync(dirname(DB_FILE), { recursive: true });
export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_salt TEXT, pin_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- 'chesscom' | 'lichess'
  username TEXT NOT NULL COLLATE NOCASE,
  last_sync INTEGER,
  UNIQUE(profile_id, provider, username)
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ext_id TEXT NOT NULL,
  url TEXT,
  username TEXT NOT NULL,
  color TEXT NOT NULL,               -- 'w' | 'b' (the profile's colour)
  white TEXT, black TEXT,
  white_rating INTEGER, black_rating INTEGER,
  result TEXT NOT NULL,              -- 'W' | 'D' | 'L' (from the profile's point of view)
  termination TEXT,
  time_class TEXT, time_control TEXT, rated INTEGER,
  played_at INTEGER,                 -- unix seconds
  eco TEXT, opening TEXT, book_plies INTEGER DEFAULT 0,
  plies INTEGER,
  pgn TEXT NOT NULL,
  moves_uci TEXT NOT NULL,           -- JSON string[]
  clocks TEXT,                       -- JSON number[] seconds remaining after each ply
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | error
  priority INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  UNIQUE(profile_id, provider, ext_id)
);
CREATE INDEX IF NOT EXISTS games_profile ON games(profile_id, played_at DESC);
CREATE INDEX IF NOT EXISTS games_status ON games(status, priority DESC, played_at DESC);
CREATE TABLE IF NOT EXISTS reviews (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  json TEXT NOT NULL,                -- GameReview
  acc_w REAL, acc_b REAL,
  analysed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS move_stats (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  mine INTEGER NOT NULL,             -- 1 when the move was played by the profile
  category TEXT NOT NULL,
  phase TEXT NOT NULL,
  loss REAL, accuracy REAL,
  PRIMARY KEY (game_id, ply)
);
CREATE INDEX IF NOT EXISTS move_stats_profile ON move_stats(profile_id, category);
CREATE TABLE IF NOT EXISTS evals (
  key TEXT PRIMARY KEY,              -- position key + engine setting
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER,
  fen TEXT NOT NULL,
  solution TEXT NOT NULL,            -- JSON UCI[] (engine best line)
  played TEXT,                       -- the move the player actually made
  category TEXT,
  theme TEXT,
  box INTEGER NOT NULL DEFAULT 0,    -- Leitner box
  due_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  UNIQUE(profile_id, game_id, ply)
);
CREATE TABLE IF NOT EXISTS rating_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, time_class TEXT NOT NULL,
  rating INTEGER NOT NULL, taken_at INTEGER NOT NULL
);
`);

// migrations for databases created by earlier versions
try { db.exec('ALTER TABLE reviews ADD COLUMN version INTEGER DEFAULT 1'); } catch { /* already there */ }

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
