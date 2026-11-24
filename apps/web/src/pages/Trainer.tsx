import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../Board';
import { api, useApi } from '../api';
import { t } from '../i18n';
import { Empty, ErrorBox, Loading } from '../ui';

interface Line { id: string; name: string; idea: string; san: string[]; uci: string[] }
interface Family { id: string; name: string; owner: 'w' | 'b'; start: string; idea: string; lines: Line[] }
type Role = 'owner' | 'counter';

/** Plays one drill: the user follows the lines for their side; the other side is played from a random consistent line. */
function Drill({ family, role, onExit, onSwap }: { family: Family; role: Role; onExit: () => void; onSwap: () => void }) {
  const userColor: 'w' | 'b' = role === 'owner' ? family.owner : family.owner === 'w' ? 'b' : 'w';
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

  const candidates = useMemo(
    () => family.lines.filter((l) => hist.every((m, i) => l.uci[i] === m)),
    [family, hist],
  );
  const turn: 'w' | 'b' = hist.length % 2 === 0 ? 'w' : 'b';
  const lastMove: [string, string] | null = hist.length ? [hist[hist.length - 1].slice(0, 2), hist[hist.length - 1].slice(2, 4)] : null;
  const userTurn = !done && turn === userColor;

  const apply = (uci: string, h: string[]) => {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    setFen(c.fen());
    setHist([...h, uci]);
    setHint(null);
  };

  // finished when no candidate line continues
  const alive = candidates.filter((l) => l.uci.length > hist.length);
  useEffect(() => {
    if (done || hist.length === 0 || alive.length > 0) return;
    const line = candidates[0] ?? family.lines[0];
    setDone(line);
    if (!reported.current) {
      reported.current = true;
      api('/trainer/result', { body: { family: family.id, line: line.id, role, mistakes } }).catch(() => {});
    }
  }, [alive.length, hist.length]); // eslint-disable-line

  // bot move
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
    const ok = alive.some((l) => l.uci[hist.length] === uci);
    if (ok) { setMsg(''); apply(uci, hist); return; }
    const m = mistakes + 1;
    setMistakes(m);
    setNonce((n) => n + 1);
    setMsg(t('tr.wrong'));
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
        <h2>{family.name}</h2>
        <p className="muted">{t('tr.youPlay', { side: t(userColor === 'w' ? 'common.white' : 'common.black') })} · {t(role === 'owner' ? 'tr.owner' : 'tr.counter')}</p>
        {!done && <p role="status" className={userTurn ? 'fb fb-info' : 'muted'}>{userTurn ? t('tr.yourMove') : msg}</p>}
        {!done && msg && userTurn && <p role="status" className="fb fb-bad">{msg}</p>}
        <p className="measured muted">{t('tr.mistakes', { n: mistakes })}</p>
        {done && (
          <div className="panel inner">
            <h3>{t('tr.done', { name: done.name })}</h3>
            <p>{mistakes === 0 ? t('tr.clean') : t('tr.mistakes', { n: mistakes })}</p>
            <p className="muted">{done.idea}</p>
            <div className="btnrow">
              <button className="btn btn-primary" onClick={onSwap}>{t('tr.swap')}</button>
              <button className="btn" onClick={restart}>{t('tr.another')}</button>
            </div>
          </div>
        )}
        <div className="btnrow">
          <button className="btn btn-quiet" onClick={restart}>{t('tr.restart')}</button>
          <button className="btn btn-quiet" onClick={onExit}>{t('tr.back')}</button>
        </div>
      </aside>
    </div>
  );
}

export function Trainer() {
  const { data, error, loading, reload } = useApi<any>('/trainer');
  const [pick, setPick] = useState<{ family: Family; role: Role } | null>(null);
  if (loading && !data) return <Loading h={300} />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!data) return <Empty title={t('common.error')} />;
  const families: Family[] = data.families;
  const prog: any[] = data.progress;

  if (pick) {
    return (
      <Drill key={pick.family.id + pick.role} family={pick.family} role={pick.role}
        onExit={() => { setPick(null); reload(); }}
        onSwap={() => { setPick({ family: pick.family, role: pick.role === 'owner' ? 'counter' : 'owner' }); }} />
    );
  }
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="stack">
      <p className="muted">{t('tr.intro')}</p>
      <p className="label">{t('tr.suggested')} — {data.note}</p>
      <div className="famgrid">
        {families.map((f) => {
          const mine = prog.filter((x) => x.line_key.startsWith(f.id + '/'));
          const due = mine.filter((x) => x.due_at <= now && x.box < 4).length;
          return (
            <section key={f.id} className="panel fam">
              <h3>{f.name}</h3>
              <p className="muted">{f.idea}</p>
              <p className="measured muted">{t('tr.lines', { n: f.lines.length })}{due ? ` · ${t('tr.due')}: ${due}` : ''}</p>
              <div className="btnrow">
                <button className="btn btn-primary" onClick={() => setPick({ family: f, role: 'owner' })}>{t('tr.owner')}</button>
                <button className="btn" onClick={() => setPick({ family: f, role: 'counter' })}>{t('tr.counter')}</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
