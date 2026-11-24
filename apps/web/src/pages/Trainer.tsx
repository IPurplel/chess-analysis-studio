import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, MoveInput } from '../Board';
import { api, useApi } from '../api';
import { getLang, t } from '../i18n';
import { Empty, ErrorBox, Loading, Segmented } from '../ui';
import { explainMove } from './explain';
import { BotGame } from './Play';

interface Line { id: string; name: string; idea: string; san: string[]; uci: string[] }
interface Family { id: string; name: string; owner: 'w' | 'b'; start: string; idea: string; lines: Line[] }
type Role = 'owner' | 'counter';

const LEVELS = [500, 800, 1100, 1400, 1700, 2000];
/** Curated notes are Arabic-only for now; English shows a generic line instead of the wrong language. */
const idea = (s: string) => (getLang() === 'ar' ? s : t('tr.noIdea'));
const colorOf = (f: Family, role: Role): 'w' | 'b' => (role === 'owner' ? f.owner : f.owner === 'w' ? 'b' : 'w');

function fensOf(line: Line): string[] {
  const c = new Chess();
  const out = [c.fen()];
  for (const u of line.uci) { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); out.push(c.fen()); }
  return out;
}

/* ------------------------------------------------------------------ guided lesson: one move at a time */
function Lesson({ family, line, role, onBack, onPractice, onPlayOn }: {
  family: Family; line: Line; role: Role; onBack: () => void; onPractice: () => void; onPlayOn: () => void;
}) {
  const fens = useMemo(() => fensOf(line), [line]);
  const userColor = colorOf(family, role);
  const [i, setI] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [wrong, setWrong] = useState(false);
  const done = i >= line.uci.length;
  const expected = done ? null : line.uci[i];
  const side: 'w' | 'b' = i % 2 === 0 ? 'w' : 'b';
  const userTurn = !done && side === userColor;
  const last: [string, string] | null = i > 0 ? [line.uci[i - 1].slice(0, 2), line.uci[i - 1].slice(2, 4)] : null;
  const why = expected ? explainMove(fens[i], expected, i > 0 ? line.uci[i - 1] : undefined) : '';

  const advance = () => { setWrong(false); setI((x) => x + 1); };
  const onMove = (uci: string) => {
    if (uci === expected) advance();
    else { setWrong(true); setNonce((n) => n + 1); }
  };
  // keyboard: Enter/Space/ArrowRight continue on the opponent's moves
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (!userTurn && !done && e.key === 'Enter') advance(); };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [userTurn, done]); // eslint-disable-line

  return (
    <div className="train">
      <Board fen={fens[i]} orientation={userColor === 'w' ? 'white' : 'black'} lastMove={last} interactive={userTurn} onMove={onMove} nonce={nonce}
        arrows={userTurn && expected ? [{ from: expected.slice(0, 2), to: expected.slice(2, 4), brush: 'green' }] : []} />
      <aside className="panel puzzle-side">
        <h2>{family.name} · {line.name}</h2>
        <progress className="stepbar" value={i} max={line.uci.length} aria-label={t('tr.stepOf', { i: Math.min(i + 1, line.uci.length), n: line.uci.length })} />
        {!done && (
          <div className="lessonstep" role="status">
            <p className="label">{t('tr.stepOf', { i: i + 1, n: line.uci.length })}</p>
            <p className="lesson-move measured" dir="ltr">{userTurn ? t('tr.play') : t('tr.watch')} <b>{line.san[i]}</b></p>
            <p>{why}</p>
            {userTurn && <p className="muted">{t('tr.learnHint')}</p>}
            {wrong && <p className="fb fb-bad" role="alert">{t('tr.wrong')}</p>}
            <div className="btnrow">
              {!userTurn && <button className="btn btn-primary" onClick={advance} autoFocus>{t('tr.continue')}</button>}
              {userTurn && <button className="btn" onClick={advance}>{t('tr.showMe')}</button>}
              {i > 0 && <button className="btn btn-quiet" onClick={() => { setWrong(false); setI(i - 1); }}>{t('tr.prevStep')}</button>}
            </div>
          </div>
        )}
        {done && (
          <div className="panel inner">
            <h3>{t('tr.theoryEnd')}</h3>
            <p className="muted">{idea(line.idea)}</p>
            <div className="btnrow">
              <button className="btn btn-primary" onClick={onPractice}>{t('tr.practice')}</button>
              <button className="btn" onClick={onPlayOn}>{t('tr.playOn')}</button>
              <button className="btn btn-quiet" onClick={() => { setI(0); setWrong(false); }}>{t('tr.restart')}</button>
            </div>
          </div>
        )}
        {userTurn && <MoveInput fen={fens[i]} onMove={onMove} />}
        <p className="label">{t('tr.moves')}</p>
        <p className="measured movesline" dir="ltr">
          {line.san.map((s, k) => (
            <button key={k} className={`sanbtn ${k < i ? 'is-played' : ''} ${k === i ? 'is-next' : ''}`} onClick={() => { setWrong(false); setI(k); }}>
              {k % 2 === 0 ? `${k / 2 + 1}. ` : ''}{s}
            </button>
          ))}
        </p>
        <div className="btnrow"><button className="btn btn-quiet" onClick={onBack}>{t('tr.backToFamily')}</button></div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ practice: follow the lines without help */
function Drill({ family, lines, role, onBack, onSwap }: { family: Family; lines: Line[]; role: Role; onBack: () => void; onSwap: () => void }) {
  const userColor = colorOf(family, role);
  const [hist, setHist] = useState<string[]>([]);
  const [fen, setFen] = useState(new Chess().fen());
  const [mistakes, setMistakes] = useState(0);
  const [msg, setMsg] = useState('');
  const [hint, setHint] = useState<{ from: string; to?: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [done, setDone] = useState<Line | null>(null);
  const reported = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const candidates = useMemo(() => lines.filter((l) => hist.every((m, i) => l.uci[i] === m)), [lines, hist]);
  const turn: 'w' | 'b' = hist.length % 2 === 0 ? 'w' : 'b';
  const lastMove: [string, string] | null = hist.length ? [hist[hist.length - 1].slice(0, 2), hist[hist.length - 1].slice(2, 4)] : null;
  const userTurn = !done && turn === userColor;

  const apply = (uci: string, h: string[]) => {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    setFen(c.fen()); setHist([...h, uci]); setHint(null);
  };
  const alive = candidates.filter((l) => l.uci.length > hist.length);

  useEffect(() => {
    if (done || hist.length === 0 || alive.length > 0) return;
    const line = candidates[0] ?? lines[0];
    setDone(line);
    if (!reported.current) {
      reported.current = true;
      api('/trainer/result', { body: { family: family.id, line: line.id, role, mistakes } }).catch(() => {});
    }
  }, [alive.length, hist.length]); // eslint-disable-line

  useEffect(() => {
    if (done || userTurn || alive.length === 0) return;
    setMsg(t('tr.opponentMove'));
    timer.current = setTimeout(() => {
      const pick = alive[Math.floor(Math.random() * alive.length)];
      apply(pick.uci[hist.length], hist);
      setMsg('');
    }, 550);
    return () => clearTimeout(timer.current);
  }, [hist.length, userTurn, done]); // eslint-disable-line

  const onMove = (uci: string) => {
    if (alive.some((l) => l.uci[hist.length] === uci)) { setMsg(''); apply(uci, hist); return; }
    const m = mistakes + 1;
    setMistakes(m); setNonce((n) => n + 1); setMsg(t('tr.wrong'));
    if (m >= 2) {
      const l = alive[0];
      setHint({ from: l.uci[hist.length].slice(0, 2), to: l.uci[hist.length].slice(2, 4) });
      setMsg(t('tr.hint', { san: l.san[hist.length] }));
    }
  };
  const restart = () => { setHist([]); setFen(new Chess().fen()); setMistakes(0); setDone(null); setMsg(''); setHint(null); reported.current = false; };

  return (
    <div className="train">
      <Board fen={fen} orientation={userColor === 'w' ? 'white' : 'black'} lastMove={lastMove} interactive={userTurn} onMove={onMove}
        arrows={hint ? [{ ...hint, brush: 'green' }] : []} nonce={nonce} />
      <aside className="panel puzzle-side">
        <h2>{family.name}{lines.length === 1 ? ` · ${lines[0].name}` : ''}</h2>
        <p className="muted">{t('tr.youPlay', { side: t(userColor === 'w' ? 'common.white' : 'common.black') })} · {t(role === 'owner' ? 'tr.owner' : 'tr.counter')}</p>
        {!done && <p role="status" className={userTurn ? 'fb fb-info' : 'muted'}>{userTurn ? t('tr.yourMove') : msg}</p>}
        {!done && msg && userTurn && <p role="status" className="fb fb-bad">{msg}</p>}
        <p className="measured muted">{t('tr.mistakes', { n: mistakes })}</p>
        {done && (
          <div className="panel inner" role="status">
            <h3>{t('tr.done', { name: done.name })}</h3>
            <p>{mistakes === 0 ? t('tr.clean') : t('tr.mistakes', { n: mistakes })}</p>
            <p className="muted">{idea(done.idea)}</p>
            <div className="btnrow">
              <button className="btn btn-primary" onClick={onSwap}>{t('tr.swap')}</button>
              <button className="btn" onClick={restart}>{t('tr.another')}</button>
            </div>
          </div>
        )}
        {userTurn && <MoveInput fen={fen} onMove={onMove} />}
        <div className="btnrow">
          <button className="btn btn-quiet" onClick={restart}>{t('tr.restart')}</button>
          <button className="btn btn-quiet" onClick={onBack}>{t('tr.backToFamily')}</button>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ play a bot from the end of the line */
function PlayOn({ family, line, role, onBack }: { family: Family; line: Line; role: Role; onBack: () => void }) {
  const [elo, setElo] = useState(800);
  const fens = useMemo(() => fensOf(line), [line]);
  return (
    <div className="stack">
      <div className="filters">
        <label className="field"><span className="label">{t('tr.botLevel')}</span>
          <select value={elo} onChange={(e) => setElo(+e.target.value)}>{LEVELS.map((l) => <option key={l} value={l}>{t('lvl.' + l)} — ~{l}</option>)}</select></label>
        <button className="btn btn-quiet" onClick={onBack}>{t('tr.backToFamily')}</button>
      </div>
      <p className="muted">{family.name} · {line.name}</p>
      <BotGame key={elo} startFen={fens[fens.length - 1]} color={colorOf(family, role)} elo={elo} />
    </div>
  );
}

/* ------------------------------------------------------------------ one opening: scenarios and modes */
function FamilyView({ family, progress, onBack, go }: { family: Family; progress: any[]; onBack: () => void; go: (v: any) => void }) {
  const [role, setRole] = useState<Role>('owner');
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="stack">
      <div className="pagehead">
        <div><h2 className="famtitle">{family.name}</h2><p className="muted measured" dir="ltr">{family.start}</p></div>
        <button className="btn btn-quiet" onClick={onBack}>{t('tr.back')}</button>
      </div>
      <p>{idea(family.idea)}</p>
      <div className="filters">
        <div className="field"><span className="label">{t('tr.chooseRole')}</span>
          <Segmented<Role> label={t('tr.chooseRole')} value={role} onChange={setRole}
            options={[{ value: 'owner', label: t('tr.owner') }, { value: 'counter', label: t('tr.counter') }]} /></div>
        <button className="btn btn-primary" onClick={() => go({ kind: 'drill', family, lines: family.lines, role })}>{t('tr.mix')}</button>
      </div>
      <p className="label">{t('tr.lineLabel')} · {t('tr.lines', { n: family.lines.length })}</p>
      <div className="famgrid">
        {family.lines.map((l) => {
          const pr = progress.find((x) => x.line_key === `${family.id}/${l.id}` && x.role === role);
          return (
            <section key={l.id} className="panel fam">
              <h3>{l.name}</h3>
              <p className="muted">{idea(l.idea)}</p>
              <p className="measured muted" dir="ltr">{l.san.slice(0, 8).map((s, k) => (k % 2 === 0 ? `${k / 2 + 1}. ` : '') + s).join(' ')} …</p>
              {pr && <p className="measured muted">{pr.clean}/{pr.attempts} ✓{pr.due_at <= now && pr.box < 4 ? ` · ${t('tr.due')}` : ''}</p>}
              <div className="btnrow">
                <button className="btn btn-primary" onClick={() => go({ kind: 'lesson', family, line: l, role })}>{t('tr.learn')}</button>
                <button className="btn" onClick={() => go({ kind: 'drill', family, lines: [l], role })}>{t('tr.practice')}</button>
                <button className="btn btn-quiet" onClick={() => go({ kind: 'play', family, line: l, role })}>{t('tr.playOn')}</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function Trainer() {
  const { data, error, loading, reload } = useApi<any>('/trainer');
  const [view, setView] = useState<any>(null);
  if (loading && !data) return <Loading h={300} />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!data) return <Empty title={t('common.error')} />;
  const families: Family[] = data.families;
  const prog: any[] = data.progress;
  const back = () => { reload(); setView(view?.family ? { kind: 'family', family: view.family } : null); };

  if (view?.kind === 'lesson') {
    return <Lesson key={view.line.id + view.role} family={view.family} line={view.line} role={view.role}
      onBack={() => setView({ kind: 'family', family: view.family })}
      onPractice={() => setView({ kind: 'drill', family: view.family, lines: [view.line], role: view.role })}
      onPlayOn={() => setView({ kind: 'play', family: view.family, line: view.line, role: view.role })} />;
  }
  if (view?.kind === 'drill') {
    return <Drill key={view.lines.map((l: Line) => l.id).join() + view.role} family={view.family} lines={view.lines} role={view.role}
      onBack={back} onSwap={() => setView({ ...view, role: view.role === 'owner' ? 'counter' : 'owner' })} />;
  }
  if (view?.kind === 'play') {
    return <PlayOn family={view.family} line={view.line} role={view.role} onBack={() => setView({ kind: 'family', family: view.family })} />;
  }
  if (view?.kind === 'family') {
    return <FamilyView family={view.family} progress={prog} onBack={() => setView(null)} go={setView} />;
  }

  const groups: [string, Family[]][] = [
    ['w', families.filter((f) => f.owner === 'w')], ['b', families.filter((f) => f.owner === 'b')],
  ];
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="stack">
      <p className="muted">{t('tr.intro')}</p>
      <p className="label">{t('tr.suggested')} — {getLang() === 'ar' ? data.note : ''}</p>
      {groups.map(([c, list]) => (
        <section key={c} className="stack">
          <h2>{t(c === 'w' ? 'tr.asWhite' : 'tr.asBlack')}</h2>
          <div className="famgrid">
            {list.map((f) => {
              const mine = prog.filter((x) => x.line_key.startsWith(f.id + '/'));
              const due = mine.filter((x) => x.due_at <= now && x.box < 4).length;
              return (
                <button key={f.id} className="panel fam famcard" onClick={() => setView({ kind: 'family', family: f })}>
                  <h3>{f.name}</h3>
                  <span className="muted measured" dir="ltr">{f.start}</span>
                  <span className="measured muted">{t('tr.lines', { n: f.lines.length })}{due ? ` · ${t('tr.due')}: ${due}` : ''}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
