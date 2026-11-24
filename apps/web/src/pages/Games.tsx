import { useState } from 'react';
import { useApi, fmt1, pct } from '../api';
import { t, dateLocal } from '../i18n';
import { Empty, ErrorBox, Loading, Tabs } from '../ui';
import { Filters } from './Filters';
import { Trainer } from './Trainer';

export function Games({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid', color = q.get('color') ?? 'all';
  const { data, error, loading, reload } = useApi<any>(`/games?tc=${tc}&color=${color}&limit=200`);
  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('games.title')}</h1><Filters tc={tc} color={color} set={setQ} /></div>
      {loading && !data ? <Loading /> : error ? <ErrorBox msg={error} retry={reload} /> : data && (
        data.games.length === 0 ? <Empty title={t('games.none')} hint={t('games.noneHint')} /> :
        <div className="panel tablewrap">
          <table className="table">
            <thead><tr><th>{t('common.date')}</th><th>{t('common.opponent')}</th><th>{t('common.opening')}</th><th className="num">{t('common.accuracy')}</th><th className="num">{t('games.brilliant')}</th><th className="num">{t('games.blunder')}</th><th>{t('common.result')}</th></tr></thead>
            <tbody>
              {data.games.map((g: any) => (
                <tr key={g.id} className="rowlink">
                  <td className="measured">{dateLocal(g.played_at)}</td>
                  <td><a href={`#/review/${g.id}`}>{g.color === 'w' ? g.black : g.white}</a> <small className="measured muted">{g.color === 'w' ? g.black_rating : g.white_rating}</small></td>
                  <td>{g.opening || '—'}</td>
                  <td className="num measured">{g.accuracy != null ? fmt1(g.accuracy, 0) + '%' : g.status === 'running' ? '…' : '—'}</td>
                  <td className="num measured">{g.accuracy != null ? g.counts.brilliant ?? 0 : '—'}</td>
                  <td className="num measured">{g.accuracy != null ? g.counts.blunder ?? 0 : '—'}</td>
                  <td><span className={`chip chip-res-${g.result}`}>{g.result === 'W' ? t('common.win') : g.result === 'L' ? t('common.loss') : t('common.draw')}</span></td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OpeningStats({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid', color = q.get('color') ?? 'all';
  const [min, setMin] = useState(2);
  const { data, error, loading, reload } = useApi<any>(`/stats?tc=${tc}&color=${color}`);
  const rows = (data?.openings ?? []).filter((o: any) => o.n >= min);
  return (
    <div className="stack">
      <div className="filters">
        <Filters tc={tc} color={color} set={setQ} />
        <label className="field"><span className="label">{t('open.minGames')}</span>
          <select value={min} onChange={(e) => setMin(+e.target.value)}>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
      </div>
      <p className="muted">{t('open.note')}</p>
      {loading && !data ? <Loading /> : error ? <ErrorBox msg={error} retry={reload} /> : rows.length === 0 ? <Empty title={t('open.none')} hint={t('open.noneHint')} /> : (
        <div className="panel tablewrap">
          <table className="table">
            <thead><tr><th>{t('common.opening')}</th><th>{t('open.you')}</th><th className="num">{t('common.games')}</th><th className="num">{t('common.win')}</th><th className="num">{t('common.draw')}</th><th className="num">{t('common.loss')}</th><th className="num">{t('common.score')}</th><th className="num">{t('common.accuracy')}</th><th className="num">{t('open.errors')}</th><th className="num">{t('open.theory')}</th></tr></thead>
            <tbody>{rows.map((o: any) => (
              <tr key={o.color + o.name}>
                <td>{o.name} <small className="measured muted">{o.eco}</small></td>
                <td>{o.color === 'w' ? t('common.white') : t('common.black')}</td>
                <td className="num measured">{o.n}</td><td className="num measured">{o.W}</td><td className="num measured">{o.D}</td><td className="num measured">{o.L}</td>
                <td className="num measured"><div className="scorebar"><div style={{ inlineSize: pct(o.score) }} /></div>{pct(o.score)}</td>
                <td className="num measured">{o.accuracy != null ? fmt1(o.accuracy, 0) + '%' : '—'}</td>
                <td className="num measured">{o.blundersPerGame != null ? fmt1(o.blundersPerGame, 1) : '—'}</td>
                <td className="num measured">{fmt1(o.avgTheoryPlies, 1)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Openings({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const [tab, setTab] = useState(q.get('tab') === 'stats' ? 'stats' : 'trainer');
  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('open.title')}</h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'trainer', label: t('open.tabTrainer') }, { id: 'stats', label: t('open.tabStats') }]} />
      {tab === 'trainer' ? <Trainer /> : <OpeningStats q={q} setQ={setQ} />}
    </div>
  );
}
