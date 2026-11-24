import { useSyncExternalStore } from 'react';
import { ar } from './lang/ar';
import { en } from './lang/en';

export type Lang = 'ar' | 'en';
const dicts: Record<Lang, Record<string, string>> = { ar, en };

function initial(): Lang {
  try {
    const s = localStorage.getItem('lang');
    if (s === 'ar' || s === 'en') return s;
  } catch { /* private mode */ }
  return 'ar';
}

let lang: Lang = initial();
const subs = new Set<() => void>();

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
apply();

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  apply();
  subs.forEach((f) => f());
}
export const getLang = () => lang;

/** Subscribes the calling component to language changes. */
export function useLang(): Lang {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => lang);
}

/** Translate a key; `{name}` placeholders are filled from params. Falls back to Arabic, then the key. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts.ar[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const num = (n: number, d = 0) => n.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const dateLocal = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
