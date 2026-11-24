import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, MoveInput } from '../Board';
import { api } from '../api';
import { t } from '../i18n';
import { Tabs } from '../ui';

const LEVELS = [500, 800, 1100, 1400, 1700, 2000, 2400, 3190];

// Verified with Stockfish by apps/server/scripts/check-endgames.ts
const ENDGAMES = [
  { id: 'kqk', fen: '8/8/8/4k3/8/8/4K3/7Q w - - 0 1', color: 'w' as const, goal: 'mate' as const },
  { id: 'krk', fen: '8/8/8/4k3/8/8/4K3/7R w - - 0 1', color: 'w' as const, goal: 'mate' as const },
  { id: 'lucena', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', color: 'w' as const, goal: 'win' as const },
  { id: 'kpk', fen: '8/8/2k5/4K3/3P4/8/8/8 w - - 0 1', color: 'w' as const, goal: 'win' as const },
  { id: 'kpk-draw', fen: '8/8/4k3/8/4PK2/8/8/8 w - - 0 1', color: 'b' as const, goal: 'draw' as const },
];

export interface GameProps { startFen: string; color: 'w' | 'b'; elo: number; goal?: 'mate' | 'win' | 'draw'; canHint?: boolean }

/** A game against the engine from any position. */
export function BotGame({ startFen, color, elo, goal, canHint = true }: GameProps) {
  const [fen, setFen] = useState(startFen);
  const hist = useRef<string[]>([startFen]);
  const sans = useRef<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [last, setLast] = useState<[string, string] | null>(null);
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null);
  const [over, setOver] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const c = new Chess(fen);
  const myTurn = c.turn() === color;

  const finish = (b: Chess) => {
    if (b.isCheckmate()) {
      const iWon = b.turn() !== color;
      setOver({ tone: iWon ? 'ok' : 'bad', text: t(iWon ? 'play.won' : 'play.lost') });
    } else if (b.isDraw() || b.isStalemate()) {
      const okDraw = goal === 'draw';
      setOver({ tone: okDraw ? 'ok' : 'bad', text: t('play.drawn') });
    }
  };

  const apply = (uci: string) => {
    const b = new Chess(fen);
    const m = b.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    hist.current.push(b.fen()); sans.current.push(m.san);
    setFen(b.fen()); setLast([uci.slice(0, 2), uci.slice(2, 4)]); setHint(null);
    finish(b);
  };

  useEffect(() => {
    if (over || myTurn || thinking) return;
    setThinking(true);
    api('/bot/move', { body: { fen, elo } }).then((r) => { if (r.uci) apply(r.uci); }).catch(() => {}).finally(() => setThinking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, over]);

  const undo = () => {
    if (thinking || hist.current.length < 3) return;
    hist.current.splice(-2); sans.current.splice(-2);
    setFen(hist.current[hist.current.length - 1]); setLast(null); setOver(null); setHint(null);
  };
  const getHint = async () => { const r = await api('/bot/move', { body: { fen, elo: 3190 } }); if (r.uci) setHint({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4) }); };

  return (
    <div className="train">
      <Board fen={fen} orientation={color === 'w' ? 'white' : 'black'} lastMove={last} interactive={myTurn && !over && !thinking} onMove={apply}
        arrows={hint ? [{ ...hint, brush: 'green' }] : []} />
      <aside className="panel puzzle-side">
        {goal && <p><b>{t('play.goal')}:</b> {t('eg.goal.' + goal)}</p>}
        <div className="btnrow">
          <button className="btn" onClick={undo} disabled={thinking}>{t('play.undo')}</button>
          {canHint && <button className="btn" onClick={getHint} disabled={!myTurn || thinking || !!over}>{t('play.hint')}</button>}
        </div>
        <p role="status" className={over ? `fb fb-${over.tone}` : 'muted'}>{over?.text ?? (thinking ? t('play.thinking') : myTurn ? t('play.yourTurn') : '')}</p>
        {myTurn && !over && !thinking && <MoveInput fen={fen} onMove={apply} />}
        <p className="measured movesline" dir="ltr">{sans.current.map((s, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '') + s).join(' ')}</p>
      </aside>
    </div>
  );
}

function Bots({ myRating, startElo }: { myRating: number | null; startElo: number | null }) {
  const target = (myRating ?? 800) + 150;
  const suggested = LEVELS.reduce((b, l) => (Math.abs(l - target) < Math.abs(b - target) ? l : b));
  const [elo, setElo] = useState(startElo ?? suggested);
  const [color, setColor] = useState<'w' | 'b'>('w');
  const [game, setGame] = useState(0);
  return (
    <div className="stack">
      <div className="filters">
        <label className="field"><span className="label">{t('play.strength')}</span>
          <select value={elo} onChange={(e) => { setElo(+e.target.value); setGame((g) => g + 1); }}>
            {LEVELS.map((l) => <option key={l} value={l}>{t('lvl.' + l)} — ~{l}</option>)}
          </select></label>
        <button className="btn" onClick={() => { setColor('w'); setGame((g) => g + 1); }}>{t('play.white')}</button>
        <button className="btn" onClick={() => { setColor('b'); setGame((g) => g + 1); }}>{t('play.black')}</button>
      </div>
      <p className="muted">{t('play.suggest', { name: t('lvl.' + suggested) })}</p>
      <BotGame key={`${game}-${color}-${elo}`} startFen={new Chess().fen()} color={color} elo={elo} />
      <small className="muted">{t('play.note')}</small>
    </div>
  );
}

function Endgames() {
  const [pick, setPick] = useState(ENDGAMES[0]);
  const [n, setN] = useState(0);
  return (
    <div className="stack">
      <p className="muted">{t('play.endgameNote')}</p>
      <div className="chips">
        {ENDGAMES.map((e) => (
          <button key={e.id} className="chip chip-btn" aria-pressed={pick.id === e.id} onClick={() => { setPick(e); setN((x) => x + 1); }}>
            {t('eg.' + (e.id === 'kpk-draw' ? 'kpk' : e.id))}{e.id === 'kpk-draw' ? ' · ' + t('eg.goal.draw') : ''}
          </button>
        ))}
        <button className="btn btn-quiet" onClick={() => setN((x) => x + 1)}>{t('tr.restart')}</button>
      </div>
      <BotGame key={`${pick.id}-${n}`} startFen={pick.fen} color={pick.color} elo={3190} goal={pick.goal} />
    </div>
  );
}

export function Play({ myRating, q }: { myRating: number | null; q: URLSearchParams }) {
  const [tab, setTab] = useState(q.get('tab') === 'endgames' ? 'endgames' : 'bots');
  const e = Number(q.get('elo'));
  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('play.title')}</h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'bots', label: t('play.tabBots') }, { id: 'endgames', label: t('play.tabEndgames') }]} />
      {tab === 'bots' ? <Bots myRating={myRating} startElo={LEVELS.includes(e) ? e : e ? LEVELS.reduce((b, l) => (Math.abs(l - e) < Math.abs(b - e) ? l : b)) : null} /> : <Endgames />}
    </div>
  );
}
