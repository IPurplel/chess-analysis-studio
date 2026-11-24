import { useEffect, useState, useCallback } from 'react';
import { t } from './i18n';

export class ApiError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export type Load<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

export function useApi<T = any>(path: string | null, deps: unknown[] = []): Load<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e) => live && setState({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { ...state, reload };
}

// ---- hash router: "#/games?tc=rapid"
export function useHash(): [string, URLSearchParams, (to: string) => void] {
  const read = () => location.hash.replace(/^#/, '') || '/';
  const [h, setH] = useState(read);
  useEffect(() => {
    const f = () => setH(read());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const [path, q = ''] = h.split('?');
  return [path, new URLSearchParams(q), (to) => { location.hash = to; }];
}

export const CATEGORY_MARK: Record<string, string> = {
  brilliant: '!!', great: '!', best: '★', excellent: '', good: '', book: '≡', inaccuracy: '?!', mistake: '?', blunder: '??',
};
export const catName = (c: string) => t('cat.' + c);
export const themeName = (th: string) => { const k = 'theme.' + th; const v = t(k); return v === k ? th : v; };
export const fmt1 = (n: number | null | undefined, d = 1) => (n == null ? '—' : n.toFixed(d));
export const pct = (n: number | null | undefined) => (n == null ? '—' : Math.round(n * 100) + '%');
export const tcName = (k: string) => t('common.' + k);
