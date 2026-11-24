import { Component, useEffect, useState, type ReactNode } from 'react';
import { api, useApi, useHash, ApiError } from './api';
import { t, useLang, setLang } from './i18n';
import { Home } from './pages/Home';
import { Games, Openings } from './pages/Games';
import { Insights } from './pages/Insights';
import { Puzzles } from './pages/Puzzles';
import { Play } from './pages/Play';
import { Sprint } from './pages/Sprint';
import { Settings } from './pages/Settings';
import { Review } from './pages/Review';
import { Icon } from './ui';

/** A crash in one page must not blank the whole app. */
class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state state-error" role="alert">
        <h2>{t('err.page')}</h2>
        <p className="measured" dir="ltr">{this.state.error.message}</p>
        <a className="btn" href="#/">{t('err.home')}</a>
      </div>
    );
  }
}

function LangSwitch() {
  const lang = useLang();
  return (
    <div className="segmented" role="group" aria-label={t('nav.language')}>
      <button aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>العربية</button>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  useLang();
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
        <div className="loginhead"><h1>{t('login.title')}</h1><LangSwitch /></div>
        <p className="muted">{t('login.sub')}</p>
        {mode === 'pick' && profiles.length > 0 && (
          <>
            <ul className="plain proflist">
              {profiles.map((p) => (
                <li key={p.name}>
                  <button className="btn profbtn" onClick={() => (p.hasPin ? setNeedPin(p.name) : login(p.name))}>{p.name}{p.hasPin ? ` ${t('login.withPin')}` : ''}</button>
                </li>))}
            </ul>
            {needPin && (
              <div className="addrow">
                <label className="field grow"><span className="label">{t('login.pinFor', { name: needPin })}</span>
                  <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login(needPin, pin)} autoFocus /></label>
                <button className="btn btn-primary" onClick={() => login(needPin, pin)}>{t('login.enter')}</button>
              </div>)}
            <button className="btn btn-quiet" onClick={() => { setMode('new'); setPin(''); setNeedPin(null); }}>{t('login.newProfile')}</button>
          </>
        )}
        {(mode === 'new' || profiles.length === 0) && (
          <>
            <label className="field"><span className="label">{t('login.name')}</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            <label className="field"><span className="label">{t('login.pinOpt')}</span><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
            <div className="btnrow">
              <button className="btn btn-primary" onClick={create} disabled={name.trim().length < 2}>{t('login.create')}</button>
              {profiles.length > 0 && <button className="btn btn-quiet" onClick={() => setMode('pick')}>{t('common.back')}</button>}
            </div>
          </>
        )}
        {err && <p className="state-error-text" role="alert">{err}</p>}
      </div>
    </main>
  );
}

const NAV: [string, string, string][] = [
  ['/', 'nav.home', 'home'], ['/games', 'nav.games', 'games'], ['/insights', 'nav.insights', 'insights'], ['/openings', 'nav.openings', 'openings'],
  ['/puzzles', 'nav.puzzles', 'puzzles'], ['/play', 'nav.play', 'play'], ['/sprint', 'nav.sprint', 'sprint'], ['/settings', 'nav.settings', 'settings'],
];

export function App() {
  useLang();
  const me = useApi<any>('/me');
  const [path, q] = useHash();
  const [menu, setMenu] = useState(false);
  const lang = useLang();
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [path]);
  // each page gets its own document title (screen readers and the tab strip rely on it)
  useEffect(() => {
    const hit = NAV.find(([to]) => (to === '/' ? path === '/' : path.startsWith(to)));
    const page = path.startsWith('/review') ? t('nav.games') : hit ? t(hit[1]) : '';
    document.title = page ? `${page} · ${t('app.name')}` : t('app.name');
  }, [path, lang]);

  if (me.loading && !me.data && !me.error) return <div className="splash" role="status" aria-busy="true" aria-label={t('common.loading')}><span className="splash-mark">{t('app.name')}</span></div>;
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
  else if (path === '/insights') view = <Insights q={q} setQ={setQ} />;
  else if (path === '/openings') view = <Openings q={q} setQ={setQ} />;
  else if (path === '/puzzles') view = <Puzzles q={q} />;
  else if (path === '/play') view = <Play myRating={me.data.ratings?.rapid ?? null} q={q} />;
  else if (path === '/sprint') view = <Sprint />;
  else if (path === '/settings') view = <Settings me={me.data} reloadMe={me.reload} />;
  else view = <Home me={me.data} />;

  return (
    <div className="shell">
      <a className="skip" href="#content" onClick={(e) => { e.preventDefault(); document.getElementById('content')?.focus(); }}>{t('a11y.skip')}</a>
      <header className="side">
        <div className="side-top">
          <a className="brand" href="#/">{t('app.name')}</a>
          <button className="btn btn-quiet menu-btn" aria-expanded={menu} aria-controls="sidenav" onClick={() => setMenu(!menu)}>{t('nav.menu')}</button>
        </div>
        <nav id="sidenav" className={menu ? 'is-open' : ''} aria-label="main">
          {NAV.map(([to, key, icon]) => <a key={to} href={'#' + to} aria-current={active(to) || (to === '/games' && !!rm) ? 'page' : undefined}><Icon name={icon} />{t(key)}</a>)}
        </nav>
        <div className={`side-bottom ${menu ? 'is-open' : ''}`}>
          <LangSwitch />
          <div className="userline">
            <span className="measured">{me.data.profile.name}</span>
            <button className="btn btn-quiet" onClick={() => api('/logout', { method: 'POST', body: {} }).then(me.reload)}>{t('nav.logout')}</button>
          </div>
        </div>
      </header>
      <main className="content" id="content" tabIndex={-1}><Boundary resetKey={path}>{view}</Boundary></main>
    </div>
  );
}
