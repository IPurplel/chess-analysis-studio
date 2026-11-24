import { Component, useState, type ReactNode } from 'react';
import { api, useApi, useHash, ApiError } from './api';
import { Dashboard, Games, Openings, Coach, Settings } from './views';
import { Review } from './Review';
import { Train, Play } from './Play';

/** A crash in one page must not blank the whole app. */
class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state state-error" role="alert">
        <h2>تعذّر عرض هذه الصفحة</h2>
        <p className="measured" dir="ltr">{this.state.error.message}</p>
        <a className="btn" href="#/">العودة للرئيسية</a>
      </div>
    );
  }
}

function Login({ onDone }: { onDone: () => void }) {
  const { data } = useApi<any>('/profiles');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [err, setErr] = useState('');
  const [needPin, setNeedPin] = useState<string | null>(null);

  const login = async (n: string, p?: string) => {
    setErr('');
    try { await api('/login', { body: { name: n, pin: p } }); onDone(); }
    catch (e) { setErr((e as ApiError).message); }
  };
  const create = async () => {
    setErr('');
    try { await api('/profiles', { body: { name: name.trim(), pin: pin || undefined } }); onDone(); }
    catch (e) { setErr((e as ApiError).message); }
  };
  const profiles: { name: string; hasPin: boolean }[] = data?.profiles ?? [];

  return (
    <main className="login">
      <div className="panel loginbox">
        <h1>استوديو الشطرنج</h1>
        <p className="muted">لكل شخص ملفه الخاص: حساباته ومبارياته وتمارينه منفصلة عن الآخرين.</p>
        {mode === 'pick' && profiles.length > 0 && (
          <>
            <ul className="plain proflist">
              {profiles.map((p) => (
                <li key={p.name}>
                  <button className="btn profbtn" onClick={() => (p.hasPin ? setNeedPin(p.name) : login(p.name))}>{p.name}{p.hasPin ? ' (برمز)' : ''}</button>
                </li>))}
            </ul>
            {needPin && (
              <div className="addrow">
                <label className="field grow"><span className="label">رمز {needPin}</span>
                  <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login(needPin, pin)} autoFocus /></label>
                <button className="btn btn-primary" onClick={() => login(needPin, pin)}>دخول</button>
              </div>)}
            <button className="btn btn-quiet" onClick={() => { setMode('new'); setPin(''); setNeedPin(null); }}>ملف جديد</button>
          </>
        )}
        {(mode === 'new' || profiles.length === 0) && (
          <>
            <label className="field"><span className="label">اسمك</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            <label className="field"><span className="label">رمز سري اختياري (أرقام)</span><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
            <div className="btnrow">
              <button className="btn btn-primary" onClick={create} disabled={name.trim().length < 2}>إنشاء الملف</button>
              {profiles.length > 0 && <button className="btn btn-quiet" onClick={() => setMode('pick')}>رجوع</button>}
            </div>
          </>
        )}
        {err && <p className="state-error-text" role="alert">{err}</p>}
      </div>
    </main>
  );
}

const NAV: [string, string][] = [['/', 'لوحتي'], ['/games', 'مبارياتي'], ['/openings', 'الافتتاحيات'], ['/coach', 'المدرب'], ['/train', 'تمارين'], ['/play', 'العب ضد بوت']];

export function App() {
  const me = useApi<any>('/me');
  const [path, q] = useHash();

  if (me.loading && !me.data && !me.error) return <div className="splash" aria-busy="true" />;
  if (me.error || !me.data) return <Login onDone={me.reload} />;

  const setQ = (k: string, v: string) => {
    const n = new URLSearchParams(q); n.set(k, v);
    location.hash = path + '?' + n.toString();
  };
  const active = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));
  const rm = path.match(/^\/review\/(\d+)/);

  let view;
  if (rm) view = <Review id={+rm[1]} />;
  else if (path === '/games') view = <Games q={q} setQ={setQ} />;
  else if (path === '/openings') view = <Openings q={q} setQ={setQ} />;
  else if (path === '/coach') view = <Coach q={q} setQ={setQ} />;
  else if (path === '/train') view = <Train />;
  else if (path === '/play') view = <Play myRating={me.data.ratings?.rapid ?? null} />;
  else if (path === '/settings') view = <Settings me={me.data} reloadMe={me.reload} />;
  else view = <Dashboard q={q} setQ={setQ} />;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#/">استوديو الشطرنج</a>
          <nav aria-label="التنقل الرئيسي">
            {NAV.map(([to, label]) => <a key={to} href={'#' + to} aria-current={active(to) ? 'page' : undefined}>{label}</a>)}
          </nav>
          <div className="userbox">
            <a href="#/settings" aria-current={path === '/settings' ? 'page' : undefined}>{me.data.profile.name}</a>
            <button className="btn btn-quiet" onClick={() => api('/logout', { method: 'POST', body: {} }).then(me.reload)}>خروج</button>
          </div>
        </div>
      </header>
      <main className="container page"><Boundary resetKey={path}>{view}</Boundary></main>
    </>
  );
}
