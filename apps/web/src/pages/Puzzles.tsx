import { useCallback, useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { api, useApi, themeName } from '../api';
import { t, num } from '../i18n';
import { Empty, ErrorBox, Loading, Reading, Tabs } from '../ui';
import { PuzzlePlayer, type PuzzleData } from './PuzzlePlayer';

const THEMES = ['hangingPiece', 'mateIn1', 'mateIn2', 'fork', 'pin', 'skewer', 'backRankMate', 'discoveredAttack', 'trappedPiece', 'deflection', 'sacrifice', 'endgame'];

function Library({ initialTheme }: { initialTheme: string }) {
  const [theme, setTheme] = useState(initialTheme);
  const [cur, setCur] = useState<{ puzzle: any; rating: number; libraryReady: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [delta, setDelta] = useState<string>('');
  const summary = useApi<any>('/training/summary');
  const status = useApi<any>('/library/status');

  const load = useCallback((th: string) => {
    setErr(''); setDelta('');
    api('/lib-puzzles/next' + (th ? `?theme=${th}` : '')).then(setCur).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(theme); }, [theme, load]);

  // while the library is still downloading, poll its status
  const importing = status.data?.status === 'downloading';
  useEffect(() => {
    if (!importing) return;
    const id = setInterval(() => { status.reload(); }, 3000);
    return () => clearInterval(id);
  }, [importing, status]);
  useEffect(() => { if (status.data?.status === 'done' && cur && !cur.libraryReady) load(theme); }, [status.data?.status]); // eslint-disable-line

  const s = summary.data;
  const p = cur?.puzzle;
  const data: PuzzleData | null = p ? { id: p.id, fen: p.fen, orientation: p.orientation, solution: p.solution, setup: p.setup, themes: p.themes } : null;

  return (
    <div className="stack">
      <div className="readings readings-3">
        <Reading label={t('pz.rating')} value={s ? num(s.rating) : '—'} />
        <Reading label={t('pz.streak')} value={s ? s.streak : '—'} />
        <Reading label={t('pz.todayCount')} value={s ? `${s.today.correct}/${s.today.puzzles}` : '—'} />
      </div>

      <div className="chips themechips" role="group" aria-label={t('pz.theme')}>
        {['', ...THEMES].map((x) => (
          <button key={x || 'mixed'} className="chip chip-btn" aria-pressed={theme === x} onClick={() => setTheme(x)}>{x ? themeName(x) : t('pz.mixed')}</button>
        ))}
      </div>

      {err && <ErrorBox msg={err} retry={() => load(theme)} />}
      {!err && !cur && <Loading h={420} />}
      {cur && !cur.libraryReady && (
        <Empty title={t('pz.libNotReady')} hint={status.data?.status === 'error' ? t('pz.libErr', { e: status.data.error }) : (status.data?.message || t('pz.libProgress'))}
          action={status.data?.status !== 'downloading' ? <button className="btn btn-primary" onClick={() => api('/library/import', { method: 'POST', body: {} }).then(status.reload)}>{t('pz.libStart')}</button> : undefined} />
      )}
      {cur && cur.libraryReady && !data && <Empty title={t('pz.noMore')} hint={t('pz.noMoreHint')} />}
      {data && (
        <>
          <PuzzlePlayer key={data.id} puzzle={data}
            onResult={(r) => api(`/lib-puzzles/${data.id}/attempt`, { body: { solved: r.solved, hints: r.hints, ms: r.ms } })
              .then((x) => { setDelta(t('pz.ratingChange', { a: x.before, b: x.after })); summary.reload(); }).catch(() => {})}
            onNext={() => load(theme)} />
          <p className="muted measured">{t('pz.rating')} · {p.rating}{delta ? ` · ${delta}` : ''}</p>
        </>
      )}
    </div>
  );
}

function Mine() {
  const { data, error, loading, reload } = useApi<any>('/puzzles/next');
  if (loading && !data) return <Loading h={420} />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  const p = data?.puzzle;
  if (!p) return <Empty title={t('pz.mineNone')} hint={t('pz.mineNoneHint')} />;
  const orientation = new Chess(p.fen).turn() === 'w' ? 'white' : 'black';
  return (
    <div className="stack">
      <p className="muted">{t('pz.mineIntro')} <span className={`chip chip-${p.category}`}>{t('cat.' + p.category)}</span>{p.game?.url && <> · <a href={p.game.url} target="_blank" rel="noreferrer">{t('pz.original')}</a></>}</p>
      <PuzzlePlayer key={p.id} puzzle={{ id: p.id, fen: p.fen, orientation, solution: p.solution }}
        onResult={(r) => { api(`/puzzles/${p.id}/attempt`, { body: { correct: r.solved } }).catch(() => {}); }}
        onNext={reload} />
    </div>
  );
}

export function Puzzles({ q }: { q: URLSearchParams }) {
  const [tab, setTab] = useState(q.get('tab') === 'mine' ? 'mine' : 'library');
  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('pz.title')}</h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'library', label: t('pz.library') }, { id: 'mine', label: t('pz.mine') }]} />
      {tab === 'library' ? <Library initialTheme={q.get('theme') ?? ''} /> : <Mine />}
    </div>
  );
}
