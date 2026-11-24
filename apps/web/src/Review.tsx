import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from './Board';
import { api, useApi, CATEGORY_AR, CATEGORY_MARK, PHASE_AR, fmt1, dateAr } from './api';

const CATS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];

function EvalChart({ win, ply, onPick, orientation }: { win: number[]; ply: number; onPick: (i: number) => void; orientation: 'w' | 'b' }) {
  const W = 600, H = 120;
  const n = win.length - 1;
  const x = (i: number) => (n ? (i / n) * W : 0);
  const val = (v: number) => (orientation === 'w' ? v : 100 - v);
  const y = (v: number) => H - (val(v) / 100) * H;
  const pts = win.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `0,${H} ${pts} ${W},${H}`;
  return (
    <svg className="evalchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="منحنى التقييم عبر المباراة"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const rel = (e.clientX - r.left) / r.width;
        // SVG x runs left-to-right even on an RTL page, and ply 0 is drawn at x = 0
        onPick(Math.max(0, Math.min(n, Math.round(rel * n))));
      }}>
      <polygon points={area} className="evalchart-area" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="evalchart-mid" />
      <polyline points={pts} className="evalchart-line" vectorEffect="non-scaling-stroke" />
      <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} className="evalchart-cursor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Review({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi<any>(`/games/${id}`);
  const [ply, setPly] = useState(0);
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
  useEffect(() => { setPly(0); }, [id]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.min(max, p + 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(max);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [max]);

  // while the engine is still working on this game, poll
  useEffect(() => {
    if (!g || review) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [g, review, reload]);

  if (loading && !data) return <div className="skeleton" style={{ height: 480 }} aria-busy="true" />;
  if (error) return <div className="state state-error" role="alert"><h2>تعذّر تحميل المباراة</h2><p>{error}</p></div>;
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

  return (
    <div className="review">
      <section className="review-board" aria-label="اللوحة">
        <div className="players">
          <span>{g.color === 'w' ? g.black : g.white}</span>
          <span className="measured">{g.color === 'w' ? g.black_rating : g.white_rating}</span>
        </div>
        <div className="boardrow">
          <div className="evalbar" aria-label={`تقييم الأبيض ${fmt1(barWhite, 0)}٪`} title={`${fmt1(barWhite, 0)}% للأبيض`}>
            <div className="evalbar-white" style={{ height: `${orient === 'white' ? barWhite : 100 - barWhite}%`, [orient === 'white' ? 'bottom' : 'top']: 0 }} />
          </div>
          <Board fen={fens[ply]} orientation={orient} lastMove={last} arrows={arrows} />
        </div>
        <div className="players">
          <span>{g.color === 'w' ? g.white : g.black} <small>(أنت)</small></span>
          <span className="measured">{g.color === 'w' ? g.white_rating : g.black_rating}</span>
        </div>
        <div className="navrow">
          <button className="btn" onClick={() => setPly(0)} aria-label="البداية">«</button>
          <button className="btn" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="السابق">›</button>
          <span className="measured navrow-pos">{ply} / {max}</span>
          <button className="btn" onClick={() => setPly((p) => Math.min(max, p + 1))} aria-label="التالي">‹</button>
          <button className="btn" onClick={() => setPly(max)} aria-label="النهاية">»</button>
        </div>
      </section>

      <section className="review-side">
        <header className="review-head">
          <h1>{g.opening || 'مباراة'}</h1>
          <p className="muted">{dateAr(g.played_at)} · {g.time_class} · {g.result === 'W' ? 'فوز' : g.result === 'L' ? 'خسارة' : 'تعادل'}{g.url ? <> — <a href={g.url} target="_blank" rel="noreferrer">المصدر</a></> : null}</p>
        </header>

        {!review && (
          <div className="state" role="status">
            <h2>{g.status === 'running' ? 'المحرك يحلل المباراة الآن' : 'في طابور التحليل'}</h2>
            <p>تظهر النتائج هنا تلقائيًا. يمكنك رفع أولويتها.</p>
            <button className="btn btn-primary" onClick={() => api(`/games/${id}/analyse`, { method: 'POST', body: {} }).then(reload)}>حلّلها الآن</button>
          </div>
        )}

        {review && (
          <>
            <div className="accrow">
              {(['w', 'b'] as const).map((c) => (
                <div key={c} className="panel acc">
                  <span className="label">{c === 'w' ? 'الأبيض' : 'الأسود'}{g.color === c ? ' (أنت)' : ''}</span>
                  <span className="reading">{fmt1(review.accuracy[c], 0)}<small>%</small></span>
                  <span className="label">دقة</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <EvalChart win={review.winWhite} ply={ply} onPick={setPly} orientation={g.color} />
            </div>

            {mv && (
              <div className={`panel movedetail cat-${mv.category}`} aria-live="polite">
                <strong>{mv.san}</strong>
                <span className={`chip chip-${mv.category}`}>{CATEGORY_MARK[mv.category]} {CATEGORY_AR[mv.category]}</span>
                <span className="muted">دقة <b className="measured">{fmt1(mv.accuracy, 0)}</b> · خسارة <b className="measured">{fmt1(mv.loss)}</b> نقطة فوز</span>
                {mv.bestSan && mv.bestUci !== mv.uci && <span>الأفضل: <b className="measured">{mv.bestSan}</b></span>}
                {mv.category === 'brilliant' && <span className="muted">تضحية بمادة {fmt1(mv.sacrifice, 0)} مع بقاء الوضع سليمًا</span>}
              </div>
            )}

            <div className="panel">
              <table className="table counts">
                <thead><tr><th>النوع</th><th className="num">الأبيض</th><th className="num">الأسود</th></tr></thead>
                <tbody>
                  {CATS.map((c) => (
                    <tr key={c}><td><span className={`chip chip-${c}`}>{CATEGORY_MARK[c]} {CATEGORY_AR[c]}</span></td>
                      <td className="num measured">{review.counts.w[c]}</td><td className="num measured">{review.counts.b[c]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <table className="table">
                <thead><tr><th>مرحلة</th><th className="num">الأبيض</th><th className="num">الأسود</th></tr></thead>
                <tbody>
                  {(['opening', 'middlegame', 'endgame'] as const).map((p) => (
                    <tr key={p}><td>{PHASE_AR[p]}</td>
                      <td className="num measured">{fmt1(review.phaseAccuracy.w[p], 0)}</td><td className="num measured">{fmt1(review.phaseAccuracy.b[p], 0)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel movelist" role="list" aria-label="النقلات">
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
