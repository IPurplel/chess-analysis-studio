// Live check of the lichess importer against a scratch database (never the real one).
// Usage: DB_FILE=<scratch.sqlite> npx tsx scripts/lichess-live.ts <public-lichess-user> [max]
import { db } from '../src/db.js';
import { syncLichess } from '../src/importers.js';

const user = process.argv[2];
if (!user) throw new Error('usage: tsx scripts/lichess-live.ts <public-lichess-username> [max]');
const max = Number(process.argv[3] ?? 15);
db.prepare("INSERT OR IGNORE INTO profiles(id,name,created_at) VALUES (1,'scratch',0)").run();
db.prepare("INSERT OR IGNORE INTO accounts(profile_id,provider,username) VALUES (1,'lichess',?)").run(user);
const r = await syncLichess(1, user, undefined, max);
console.log('sync result', r);
console.log(db.prepare('SELECT color, result, time_class, opening, plies, white, black FROM games ORDER BY played_at DESC LIMIT 3').all());
