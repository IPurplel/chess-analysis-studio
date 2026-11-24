import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../Board';
import { api, useApi, catName, CATEGORY_MARK, fmt1 } from '../api';
import { t, dateLocal } from '../i18n';
import { ErrorBox, Loading } from '../ui';
import { KIND_THEME } from './Insights';
import { PuzzlePlayer } from './PuzzlePlayer';

const CATS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];

function EvalChart({ win, ply, onPick, orientation }: { win: number[]; ply: number; onPick: (i: number) => void; orientation: 'w' | 'b' }) {
  const W = 600, H = 120;
  const n = win.length - 1;
  const x = (i: number) => (n ? (i / n) * W : 0);
  const val = (v: number) => (orientation === 'w' ? v : 100 - v);
  const y = (v: number) => H - (val(v) / 100) * H;
  const pts = win.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="evalchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('rev.eval')}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        // SVG x runs left-to-right even on an RTL page, and ply 0 is drawn at x = 0
        onPick(Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n))));
      }}>
      <polygon points={`0,${H} ${pts} ${W},${H}`} className="evalchart-area" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="evalchart-mid" />
      <polyline points={pts} className="evalchart-line" vectorEffect="non-scaling-stroke" />
      <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} className="evalchart-cursor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function CountCell({ n, onClick, cur }: { n: number; onClick: () => void; cur?: number }) {
  if (!n) return <span className="measured muted">0</span>;
  return <button className="countbtn measured" onClick={onClick} title={t('rev.jumpHint')}>{cur != null ? `${cur + 1}/${n}` : n}</button>;
}

export function Review({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi<any>(`/games/${id}`);
  const [ply, setPly] = useState(0);
  const [practice, setPractice] = useState<null | { fen: string; solution: string[]; orientation: 'white' | 'black'; san: string }>(null);
  const [cursor, setCursor] = useState<Record<string, number>>({});
  const g = data?.game;
  const review = data?.review;

  const fens = useMemo(() => {
    if (!g) return [new Chess().fen()];
    const c = new Chess();
    const out = [c.fen()];
    for (const u of g.moves as string[]) {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      out.push(c.fen());
    }
    return out;
  }, [g]);

  const max = g ? g.moves.length : 0;
  useEffect(() => { setPly(0); setPractice(null); setCursor({}); }, [id]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, Math.min(max, p + dir)));
      else if (e.key === 'ArrowRight') setPly((p) => Math.max(0, Math.min(max, p - dir)));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(max);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [max]);

  useEffect(() => {
    if (!g || review) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [g, review, reload]);

  if (loading && !data) return <Loading h={480} />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!g) return null;

  const mv = ply > 0 ? review?.moves?.[ply - 1] : null;
  const last = ply > 0 ? [g.moves[ply - 1].slice(0, 2), g.moves[ply - 1].slice(2, 4)] as [string, string] : null;
  const arrows: { from: string; to: string; brush: 'green' | 'red' | 'blue' }[] = [];
  if (mv && ['inaccuracy', 'mistake', 'blunder'].includes(mv.category) && mv.bestUci) {
    arrows.push({ from: mv.bestUci.slice(0, 2), to: mv.bestUci.slice(2, 4), brush: 'green' });
  }
  const orient = g.color === 'w' ? 'white' : 'black';
  const winW: number[] | undefined = review?.winWhite;
  const barWhite = winW ? winW[ply] : 50;
  const rows: any[] = [];
  if (review) for (let i = 0; i < review.moves.length; i += 2) rows.push([review.moves[i], review.moves[i + 1]]);
  const jump = (cat: string, color: 'w' | 'b') => {
    const list = (review?.moves ?? []).filter((m: any) => m.category === cat && m.color === color);
    if (!list.length) return;
    const key = cat + color;
    const next = ((cursor[key] ?? -1) + 1) % list.length;
    setCursor({ ...cursor, [key]: next });
    setPractice(null);
    setPly(list[next].ply + 1);
  };
  const myMoves = Math.ceil(max / 2) * (g.color === 'w' ? 1 : 0) + Math.floor(max / 2) * (g.color === 'w' ? 0 : 1);
  const oppMoves = max - myMoves;
  const startPractice = (m: any) => {
    const pv: string[] = (review?.evals?.[m.ply]?.lines?.[0]?.pv ?? []).slice(0, 8);
    if (pv.length < 1) return;
    setPractice({ fen: fens[m.ply], solution: pv, orientation: m.color === 'w' ? 'white' : 'black', san: m.san });
  };
  const oppName = g.color === 'w' ? g.black : g.white;
  const oppRating = g.color === 'w' ? g.black_rating : g.white_rating;
  const myName = g.color === 'w' ? g.white : g.black;
  const myRating = g.color === 'w' ? g.white_rating : g.black_rating;

  if (practice) {
    return (
      <div className="stack">
        <div className="pagehead">
          <h1>{t('rev.practiceTitle', { san: practice.san })}</h1>
          <button className="btn" onClick={() => setPractice(null)}>{t('rev.backToReview')}</button>
        </div>
        <p className="muted">{t('rev.practiceHint')}</p>
        <PuzzlePlayer key={practice.fen} puzzle={{ id: practice.fen, fen: practice.fen, orientation: practice.orientation, solution: practice.solution }}
          onResult={() => {}} onNext={() => setPractice(null)} />
      </div>
    );
  }

  return (
    <div className="review">
      <section className="review-board" aria-label="board">
        <div className="players"><span>{oppName}</span><span className="measured">{oppRating}</span></div>
        <div className="boardrow">
          <div className="evalbar" role="img" aria-label={`${fmt1(barWhite, 0)}%`} title={`${fmt1(barWhite, 0)}%`}>
            <div className="evalbar-white" style={{ blockSize: `${orient === 'white' ? barWhite : 100 - barWhite}%`, [orient === 'white' ? 'insetBlockEnd' : 'insetBlockStart']: 0 }} />
          </div>
          <Board fen={fens[ply]} orientation={orient} lastMove={last} arrows={arrows} />
        </div>
        <div className="players"><span>{myName} <small>({t('common.you')})</small></span><span className="measured">{myRating}</span></div>
        <div className="navrow">
          <button className="btn" onClick={() => setPly(0)} aria-label={t('rev.start')}>«</button>
          <button className="btn" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label={t('rev.prev')}>‹</button>
          <span className="measured navrow-pos">{ply} / {max}</span>
          <button className="btn" onClick={() => setPly((p) => Math.min(max, p + 1))} aria-label={t('rev.next')}>›</button>
          <button className="btn" onClick={() => setPly(max)} aria-label={t('rev.end')}>»</button>
        </div>
      </section>

      <section className="review-side">
        <header className="review-head">
          <h1>{g.opening || '—'}</h1>
          <p className="muted">{dateLocal(g.played_at)} · {g.time_class} · {g.result === 'W' ? t('rev.win') : g.result === 'L' ? t('rev.lose') : t('rev.draw')}{g.url ? <> — <a href={g.url} target="_blank" rel="noreferrer">{t('common.source')}</a></> : null}</p>
          <p className="muted">{t('rev.moveCount', { me: myMoves, opp: oppMoves })}</p>
        </header>

        {!review && (
          <div className="state" role="status">
            <h2>{g.status === 'running' ? t('rev.analysing') : t('rev.queued')}</h2>
            <p>{t('rev.queuedHint')}</p>
            <button className="btn btn-primary" onClick={() => api(`/games/${id}/analyse`, { method: 'POST', body: {} }).then(reload)}>{t('rev.analyseNow')}</button>
          </div>
        )}

        {review && (
          <>
            <div className="accrow">
              {(['w', 'b'] as const).map((c) => (
                <div key={c} className="panel acc">
                  <span className="label">{t(c === 'w' ? 'common.white' : 'common.black')}{g.color === c ? ` (${t('common.you')})` : ''}</span>
                  <span className="reading">{fmt1(review.accuracy[c], 0)}<small>%</small></span>
                  <span className="label">{t('common.accuracy')}</span>
                </div>
              ))}
            </div>

            <div className="panel"><EvalChart win={review.winWhite} ply={ply} onPick={setPly} orientation={g.color} /></div>

            {mv && (
              <div className={`panel movedetail cat-${mv.category}`} aria-live="polite">
                <strong dir="ltr">{mv.san}</strong>
                <span className={`chip chip-${mv.category}`}>{CATEGORY_MARK[mv.category]} {catName(mv.category)}</span>
                <span className="muted">{t('common.accuracy')} <b className="measured">{fmt1(mv.accuracy, 0)}</b> · {t('rev.loss')} <b className="measured">{fmt1(mv.loss)}</b> {t('rev.winPts')}</span>
                {mv.bestSan && mv.bestUci !== mv.uci && <span>{t('rev.best')}: <b className="measured" dir="ltr">{mv.bestSan}</b></span>}
                {mv.kind && (
                  <span className="kindrow">{t('rev.whyBad')}: <b>{t('kind.' + mv.kind)}</b>{mv.color === g.color && <> <a className="btn btn-quiet" href={`#/puzzles?theme=${KIND_THEME[mv.kind] ?? ''}`}>{t('rev.trainKind')}</a></>}</span>
                )}
                {mv.color === g.color && ['inaccuracy', 'mistake', 'blunder'].includes(mv.category) && <button className="btn btn-primary" onClick={() => startPractice(mv)}>{t('rev.practice')}</button>}
                {mv.category === 'brilliant' && <span className="muted">{t('rev.sacrifice', { n: fmt1(mv.sacrifice, 0) })}</span>}
              </div>
            )}

            <div className="panel">
              <table className="table counts">
                <caption className="visually-hidden">{t('rev.jumpHint')}</caption><thead><tr><th>{t('rev.type')}</th><th className="num">{t('common.white')}</th><th className="num">{t('common.black')}</th></tr></thead>
                <tbody>
                  {CATS.map((c) => (
                    <tr key={c}><td><span className={`chip chip-${c}`}>{CATEGORY_MARK[c]} {catName(c)}</span></td>
                      <td className="num"><CountCell n={review.counts.w[c]} onClick={() => jump(c, 'w')} cur={cursor[c + 'w']} /></td><td className="num"><CountCell n={review.counts.b[c]} onClick={() => jump(c, 'b')} cur={cursor[c + 'b']} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <table className="table">
                <thead><tr><th>{t('rev.phase')}</th><th className="num">{t('common.white')}</th><th className="num">{t('common.black')}</th></tr></thead>
                <tbody>
                  {(['opening', 'middlegame', 'endgame'] as const).map((p) => (
                    <tr key={p}><td>{t('phase.' + p)}</td>
                      <td className="num measured">{fmt1(review.phaseAccuracy.w[p], 0)}</td><td className="num measured">{fmt1(review.phaseAccuracy.b[p], 0)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel movelist" role="list" aria-label={t('rev.moves')}>
              {rows.map((r, i) => (
                <div className="moverow" key={i} role="listitem">
                  <span className="measured movenum">{i + 1}</span>
                  {r.map((m: any, j: number) => m && (
                    <button key={j} className={`movecell ${ply === m.ply + 1 ? 'is-current' : ''} cat-${m.category}`} onClick={() => setPly(m.ply + 1)}>
                      <span dir="ltr">{m.san}</span><span className={`mark mark-${m.category}`}>{CATEGORY_MARK[m.category]}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
