import type { ReactNode } from 'react';
import { t } from './i18n';

export function Loading({ h = 220 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} role="status" aria-busy="true" aria-label={t('common.loading')} />;
}

export function ErrorBox({ msg, retry }: { msg: string; retry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <h2>{t('common.error')}</h2>
      <p>{msg}</p>
      {retry && <button className="btn" onClick={retry}>{t('common.retry')}</button>}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((x) => (
        <button key={x.id} role="tab" aria-selected={value === x.id} className="tab" onClick={() => onChange(x.id)}>{x.label}</button>
      ))}
    </div>
  );
}

/** Horizontal bars with the numbers as text, so the chart is readable without colour or sight. */
export function BarList({ rows, tone = 'cool' }: { rows: { label: string; value: number; shown?: string; sub?: string }[]; tone?: 'cool' | 'bad' | 'accent' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="barlist-label">{r.label}</span>
          <span className="barlist-track" aria-hidden="true"><i className={`tone-${tone}`} style={{ inlineSize: `${(100 * r.value) / max}%` }} /></span>
          <span className="measured barlist-val">{r.shown ?? r.value}</span>
          {r.sub && <span className="barlist-sub">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Reading({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'ok' }) {
  return (
    <div className="panel reading-card">
      <span className="label">{label}</span>
      <span className={`reading ${tone ?? ''}`}>{value}</span>
      {sub && <span className="label">{sub}</span>}
    </div>
  );
}

const ICONS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  games: 'M5 6h14M5 12h14M5 18h9',
  insights: 'M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6',
  openings: 'M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5ZM8 17h10',
  puzzles: 'M12 3v4m0 0a2.5 2.5 0 1 1-2.5 2.5M12 7a2.5 2.5 0 1 0 2.5 2.5M6 21v-4a6 6 0 0 1 12 0v4H6Z',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  sprint: 'M6 21V4m0 1h11l-2 4 2 4H6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-1-3-2.2.4-1.4-1.6.3-2.3-3-1-1.2 1.9h-2L9.3 3.5l-3 1 .3 2.3-1.4 1.6L3 8l-1 3 2 1v2l-2 1 1 3 2.2-.4 1.4 1.6-.3 2.3 3 1 1.2-1.9h2l1.2 1.9 3-1-.3-2.3 1.4-1.6L20 17l1-3-2-1v-1Z',
};
/** Small stroke icons for the sidebar (decorative: the label next to them carries the meaning). */
export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name] ?? ICONS.home} />
    </svg>
  );
}
