import { useApi, fmt1, themeName } from '../api';
import { t, num, dateLocal } from '../i18n';
import { Empty, ErrorBox, Loading, Reading } from '../ui';
import { KIND_THEME } from './Insights';
import { taskHref, taskLabel, useSprint } from './Sprint';

export function Home({ me }: { me: any }) {
  const stats = useApi<any>('/stats?tc=rapid');
  const games = useApi<any>('/games?tc=rapid&limit=5');
  const train = useApi<any>('/training/summary');
  const an = useApi<any>('/analysis/status');
  const sprint = useSprint();

  if (stats.loading && !stats.data) return <Loading h={420} />;
  if (stats.error) return <ErrorBox msg={stats.error} retry={stats.reload} />;
  const s = stats.data;
  if (!s || !s.totals.games) {
    return <Empty title={t('home.noGames')} hint={t('home.noGamesHint')} action={<a className="btn btn-primary" href="#/settings">{t('nav.settings')}</a>} />;
  }
  const pending = (an.data?.byStatus?.pending ?? 0) + (an.data?.byStatus?.running ?? 0);
  const kinds = Object.entries((s.insights?.kinds ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const kindTotal = kinds.reduce((x, [, n]) => x + n, 0);
  const ph = (s.insights?.phaseDetail ?? {}) as Record<string, any>;
  const worst = Object.keys(ph).sort((a, b) => ph[b].blundersPer100 - ph[a].blundersPer100)[0];

  const plan = sprint.data?.plan;
  const today = plan?.days.find((d: any) => d.isToday);
  const done = today ? today.tasks.filter((k: any) => sprint.data.done[`${today.date}:${k.id}`]).length : 0;
  const daysLeft = sprint.data?.settings.contestDate
    ? Math.round((Date.parse(sprint.data.settings.contestDate) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000) : null;

  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('home.title')}</h1></div>
      {pending > 0 && <div className="note" role="status">{t('home.analysing', { n: pending })}</div>}

      <div className="readings">
        <Reading label={t('home.rating')} value={me.ratings?.rapid ?? '—'} />
        <Reading label={t('stats.blunders')} value={fmt1(s.totals.blunderPerGame, 1)} tone="bad" sub={t('common.perGame')} />
        <Reading label={t('home.streak')} value={train.data?.streak ?? '—'} />
        <Reading label={t('home.today')} value={train.data ? `${train.data.today.correct}/${train.data.today.puzzles}` : '—'} />
      </div>

      <div className="split">
        <section className="panel">
          <h2>{t('home.mission')}</h2>
          {!today ? (
            <>
              <p className="muted">{t('home.noSprint')} {t('home.noSprintHint')}</p>
              <a className="btn btn-primary" href="#/sprint">{t('home.setSprint')}</a>
            </>
          ) : (
            <>
              <p className="muted">{daysLeft != null && (daysLeft > 0 ? t('home.daysLeft', { n: daysLeft }) : t('home.contestToday'))} · {t('home.tasksDone', { done, total: today.tasks.length })}</p>
              <ul className="tasklist">
                {today.tasks.map((k: any) => {
                  const isDone = !!sprint.data.done[`${today.date}:${k.id}`];
                  const href = taskHref(k);
                  return (
                    <li key={k.id} className={isDone ? 'is-done' : ''}>
                      <label className="check"><input type="checkbox" checked={isDone} onChange={(e) => sprint.toggle(today.date, k.id, e.target.checked)} /><span>{taskLabel(k)}</span></label>
                      <span className="measured muted">{k.minutes ? `${k.minutes} ${t('common.minutes')}` : ''}</span>
                      {href && !isDone && <a className="btn btn-quiet" href={href}>{t('sp.go')}</a>}
                    </li>
                  );
                })}
              </ul>
              <a className="btn" href="#/sprint">{t('home.goSprint')}</a>
            </>
          )}
        </section>

        <section className="panel">
          <h2>{t('home.focus')}</h2>
          {kinds[0] ? (
            <>
              <p>{t('home.dominant', { kind: t('kind.' + kinds[0][0]), pct: Math.round((100 * kinds[0][1]) / kindTotal) })}</p>
              <p className="muted">{t('kind.hint.' + kinds[0][0])}</p>
              <a className="btn btn-primary" href={`#/puzzles?theme=${KIND_THEME[kinds[0][0]] ?? ''}`}>{t('ins.trainThis')} · {themeName(KIND_THEME[kinds[0][0]] ?? '')}</a>
            </>
          ) : <p className="muted">{t('ins.noData')}</p>}
          {worst && <p className="muted">{t('ins.phases')} <b>{t('phase.' + worst)}</b> · <span className="measured">{fmt1(ph[worst].blundersPer100, 1)}</span> {t('ins.per100')}</p>}
          <a className="btn" href="#/insights">{t('nav.insights')}</a>
        </section>
      </div>

      <section className="panel">
        <h2>{t('home.recent')}</h2>
        {games.data?.games?.length ? (
          <ul className="plain recent">
            {games.data.games.map((g: any) => (
              <li key={g.id}>
                <a href={`#/review/${g.id}`}>{g.color === 'w' ? g.black : g.white}</a>
                <span className="muted">{g.opening || '—'}</span>
                <span className="measured">{g.accuracy != null ? fmt1(g.accuracy, 0) + '%' : '…'}</span>
                <span className={`chip chip-res-${g.result}`}>{g.result === 'W' ? t('common.win') : g.result === 'L' ? t('common.loss') : t('common.draw')}</span>
                <span className="measured muted">{dateLocal(g.played_at)}</span>
              </li>
            ))}
          </ul>
        ) : <Loading h={80} />}
        <p className="muted measured">{num(s.totals.games)} {t('common.games')}</p>
      </section>
    </div>
  );
}
