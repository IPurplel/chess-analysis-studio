import { useApi, fmt1, catName, CATEGORY_MARK } from '../api';
import { t, num, dateLocal } from '../i18n';
import { BarList, Empty, ErrorBox, Loading, Reading } from '../ui';
import { Filters } from './Filters';

export const KIND_THEME: Record<string, string> = {
  'hangs-piece': 'hangingPiece', 'allows-tactic': 'fork', 'allows-mate': 'mateIn1', 'missed-mate': 'mateIn2', 'missed-material': 'fork', positional: 'defensiveMove',
};

function RatingChart({ points }: { points: { t: number; rating: number | null }[] }) {
  const pts = points.filter((p) => p.rating != null) as { t: number; rating: number }[];
  if (pts.length < 2) return <p className="muted">{t('stats.notEnough')}</p>;
  const W = 600, H = 150;
  const min = Math.min(...pts.map((p) => p.rating)), max = Math.max(...pts.map((p) => p.rating));
  const span = Math.max(40, max - min);
  const line = pts.map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 10 - ((p.rating - min) / span) * (H - 20)).toFixed(1)}`).join(' ');
  return (
    <figure className="chartfig">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="linechart" role="img" aria-label={t('stats.ratingTrend')}>
        <polyline points={line} className="linechart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="muted"><span className="measured">{min}</span> → <span className="measured">{max}</span> · {dateLocal(pts[0].t)} → {dateLocal(pts[pts.length - 1].t)}</figcaption>
    </figure>
  );
}

export function Insights({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid', color = q.get('color') ?? 'all';
  const { data, error, loading, reload } = useApi<any>(`/stats?tc=${tc}&color=${color}`);
  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('ins.title')}</h1><Filters tc={tc} color={color} set={setQ} /></div>
      {loading && !data ? <Loading h={320} /> : error ? <ErrorBox msg={error} retry={reload} /> : data && (() => {
        const o = data.totals;
        if (!o.analysed) return <Empty title={t('ins.noData')} hint={t('home.noGamesHint')} />;
        const ph = data.insights.phaseDetail as Record<string, any>;
        const phases = (['opening', 'middlegame', 'endgame'] as const).filter((k) => ph[k]);
        const worst = phases.slice().sort((a, b) => ph[b].blundersPer100 - ph[a].blundersPer100)[0];
        const kinds = Object.entries(data.insights.kinds as Record<string, number>).sort((a, b) => b[1] - a[1]);
        const kindTotal = kinds.reduce((s, [, n]) => s + n, 0) || 1;
        const col = data.insights.collapse as Record<string, number>;
        const tp = data.timePressure;
        const rate = (b: { moves: number; blunders: number }) => (b.moves ? (100 * b.blunders) / b.moves : null);
        return (
          <>
            <div className="readings">
              <Reading label={t('stats.brilliant')} value={o.brilliant} sub={<><span className="measured">{fmt1(o.brilliantPerGame, 2)}</span> {t('common.perGame')}</>} />
              <Reading label={t('stats.blunders')} value={o.blunder} tone="bad" sub={<><span className="measured">{fmt1(o.blunderPerGame, 2)}</span> {t('common.perGame')}</>} />
              <Reading label={t('stats.avgAcc')} value={<>{fmt1(o.avgAccuracy, 0)}<small>%</small></>} sub={t('stats.analysedOf', { n: o.analysed })} />
              <Reading label={t('stats.results')} value={<>{o.W}<small>/{o.D}/{o.L}</small></>} sub={t('stats.wdl', { n: o.games })} />
            </div>

            <section className="panel">
              <h2>{t('ins.phases')}</h2>
              <p className="muted">{t('ins.phasesHint')}</p>
              <div className="phasegrid">
                {phases.map((k) => (
                  <div key={k} className={`phasecard ${k === worst ? 'is-worst' : ''}`}>
                    <h3>{t('phase.' + k)} {k === worst && <span className="chip chip-blunder">{t('ins.verdict.weak')}</span>}</h3>
                    <span className="reading">{fmt1(ph[k].blundersPer100, 1)}</span>
                    <span className="label">{t('ins.per100')}</span>
                    <span className="label">{t('common.accuracy')}: <span className="measured">{fmt1(ph[k].accuracy, 0)}%</span> · {t('ins.avgLoss')}: <span className="measured">{fmt1(ph[k].avgLoss, 1)}</span></span>
                  </div>
                ))}
              </div>
            </section>

            <div className="split">
              <section className="panel">
                <h2>{t('ins.kinds')}</h2>
                <p className="muted">{t('ins.kindsHint')}</p>
                <BarList tone="bad" rows={kinds.map(([k, n]) => ({ label: t('kind.' + k), value: n, shown: `${n} (${Math.round((100 * n) / kindTotal)}%)` }))} />
                {kinds[0] && (
                  <p className="callout">{t('kind.hint.' + kinds[0][0])} <a className="btn btn-primary" href={`#/puzzles?theme=${KIND_THEME[kinds[0][0]] ?? ''}`}>{t('ins.trainThis')}</a></p>
                )}
              </section>
              <section className="panel">
                <h2>{t('ins.collapse')}</h2>
                <p className="muted">{t('ins.collapseHint')}</p>
                <BarList tone="accent" rows={Object.entries(col).map(([k, n]) => ({ label: k, value: n }))} />
              </section>
            </div>

            {tp.games > 0 && (
              <section className="panel">
                <h2>{t('ins.time')}</h2>
                <table className="table"><thead><tr><th>&nbsp;</th><th className="num">{t('ins.timeMoves')}</th><th className="num">{t('stats.blunders')}</th><th className="num">{t('ins.timeRate')}</th></tr></thead>
                  <tbody>
                    <tr><td>{t('ins.timeEnough')}</td><td className="num measured">{tp.normal.moves}</td><td className="num measured">{tp.normal.blunders}</td><td className="num measured">{fmt1(rate(tp.normal), 1)}%</td></tr>
                    <tr><td>{t('ins.timeLow')}</td><td className="num measured">{tp.trouble.moves}</td><td className="num measured">{tp.trouble.blunders}</td><td className="num measured">{fmt1(rate(tp.trouble), 1)}%</td></tr>
                  </tbody></table>
                <p className="muted">{t('ins.timeLosses', { a: tp.timeoutLosses, b: tp.losses })}</p>
              </section>
            )}

            <div className="split">
              <section className="panel"><h2>{t('stats.ratingTrend')}</h2><RatingChart points={data.timeline} /></section>
              <section className="panel">
                <h2>{t('stats.moveQuality')}</h2>
                <div className="catgrid">
                  {['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'].map((c) => (
                    <div key={c} className="catcell"><span className={`chip chip-${c}`}>{CATEGORY_MARK[c]} {catName(c)}</span><span className="measured">{num(o[c])}</span></div>
                  ))}
                </div>
              </section>
            </div>
          </>
        );
      })()}
    </div>
  );
}
