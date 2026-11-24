import { useEffect, useState } from 'react';
import { api, useApi, themeName } from '../api';
import { t, dateLocal } from '../i18n';
import { ErrorBox, Loading } from '../ui';

export function taskLabel(k: any): string {
  switch (k.type) {
    case 'puzzles': return t('sp.task.puzzles', { theme: k.theme ? themeName(k.theme) : t('pz.mixed') });
    case 'play-bot': return t('sp.task.play-bot', { elo: k.opponentElo });
    default: return t('sp.task.' + k.type);
  }
}
export function taskHref(k: any): string | null {
  switch (k.type) {
    case 'puzzles': return `#/puzzles?theme=${k.theme ?? ''}`;
    case 'my-mistakes': return '#/puzzles?tab=mine';
    case 'play-bot': return `#/play?elo=${k.opponentElo}`;
    case 'opening': return '#/openings?tab=trainer';
    case 'endgame': return '#/play?tab=endgames';
    default: return null;
  }
}

export function useSprint() {
  const s = useApi<any>('/sprint');
  const toggle = async (day: string, id: string, done: boolean) => { await api('/sprint/check', { body: { key: `${day}:${id}`, done } }); s.reload(); };
  return { ...s, toggle };
}

export function Sprint() {
  const { data, error, loading, reload, toggle } = useSprint();
  const [form, setForm] = useState({ contestDate: '', target: 1200, minutes: 60 });
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setForm(data.settings); }, [data?.settings?.contestDate]); // eslint-disable-line

  if (loading && !data) return <Loading h={360} />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  const plan = data.plan;
  return (
    <div className="stack">
      <div className="pagehead"><h1>{t('sp.title')}</h1></div>
      <section className="panel">
        <div className="addrow">
          <label className="field"><span className="label">{t('sp.contestDate')}</span>
            <input type="date" value={form.contestDate} onChange={(e) => setForm({ ...form, contestDate: e.target.value })} /></label>
          <label className="field"><span className="label">{t('sp.target')}</span>
            <input type="number" min={400} max={2500} step={50} value={form.target} onChange={(e) => setForm({ ...form, target: +e.target.value })} /></label>
          <label className="field"><span className="label">{t('sp.minutes')}</span>
            <input type="number" min={15} max={240} step={5} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: +e.target.value })} /></label>
          <button className="btn btn-primary" onClick={async () => { await api('/sprint', { method: 'PUT', body: form }); setSaved(true); reload(); setTimeout(() => setSaved(false), 1500); }}>{saved ? t('sp.saved') : t('common.save')}</button>
        </div>
        <p className="callout"><b>{t('sp.honest')}:</b> {t(plan.honest.key, plan.honest.params)}</p>
      </section>

      <section className="panel">
        <h2>{t('sp.focus')}</h2>
        <p className="chips">{plan.focus.themes.slice(0, 4).map((x: string) => <span key={x} className="chip">{themeName(x)}</span>)}</p>
        <h3>{t('sp.habit.title')}</h3>
        <ol className="plain-ol"><li>{t('sp.habit.1')}</li><li>{t('sp.habit.2')}</li><li>{t('sp.habit.3')}</li></ol>
      </section>

      {!data.settings.contestDate && <p className="muted">{t('sp.noDate')}</p>}
      <div className="daygrid">
        {plan.days.map((d: any) => (
          <section key={d.date} className={`panel day ${d.isToday ? 'is-today' : ''}`}>
            <h3>{dateLocal(Date.parse(d.date) / 1000)} {d.isToday && <span className="chip chip-brilliant">{t('sp.today')}</span>} {d.isContest && <span className="chip chip-mistake">{t('sp.contestDay')}</span>}</h3>
            <ul className="tasklist">
              {d.tasks.map((k: any) => {
                const key = `${d.date}:${k.id}`;
                const href = taskHref(k);
                const done = !!data.done[key];
                return (
                  <li key={k.id} className={done ? 'is-done' : ''}>
                    <label className="check"><input type="checkbox" checked={done} onChange={(e) => toggle(d.date, k.id, e.target.checked)} />
                      <span>{taskLabel(k)}{k.type === 'puzzles' && k.count ? ` · ${t('sp.count', { n: k.count })}` : ''}</span></label>
                    <span className="measured muted">{k.minutes ? `${k.minutes} ${t('common.minutes')}` : ''}</span>
                    {href && !done && <a className="btn btn-quiet" href={href}>{t('sp.go')}</a>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
