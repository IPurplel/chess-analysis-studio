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
