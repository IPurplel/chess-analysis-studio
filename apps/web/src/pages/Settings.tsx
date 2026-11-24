import { useState } from 'react';
import { api, useApi } from '../api';
import { t, num } from '../i18n';

export function Settings({ me, reloadMe }: { me: any; reloadMe: () => void }) {
  const [provider, setProvider] = useState('chesscom');
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState('');
  const sync = useApi<any>('/sync/status');
  const an = useApi<any>('/analysis/status');
  const lib = useApi<any>('/library/status');
  const add = async () => {
    setMsg('');
    try { await api('/accounts', { body: { provider, username: username.trim() } }); setUsername(''); reloadMe(); }
    catch (e: any) { setMsg(e.message); }
  };
  const run = async () => {
    await api('/sync', { method: 'POST', body: {} });
    const id = setInterval(() => { sync.reload(); an.reload(); }, 2000);
    setTimeout(() => clearInterval(id), 120000);
    sync.reload();
  };
  const st = sync.data;
  const by = an.data?.byStatus ?? {};
  return (
    <div className="stack narrow">
      <h1>{t('set.title')}</h1>
      <section className="panel">
        <h2>{t('set.accounts')}</h2>
        {me.accounts.length === 0 ? <p className="muted">{t('set.noAccounts')}</p> : (
          <ul className="plain">{me.accounts.map((a: any) => (
            <li key={a.provider + a.username} className="acctrow"><span>{a.provider === 'chesscom' ? 'chess.com' : 'lichess'} — <b className="measured">{a.username}</b></span>
              <button className="btn btn-quiet" onClick={() => api(`/accounts/${a.provider}/${a.username}`, { method: 'DELETE' }).then(reloadMe)}>{t('common.remove')}</button></li>))}</ul>)}
        <div className="addrow">
          <label className="field"><span className="label">{t('set.platform')}</span><select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="chesscom">chess.com</option><option value="lichess">lichess</option></select></label>
          <label className="field grow"><span className="label">{t('set.username')}</span><input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
          <button className="btn btn-primary" onClick={add} disabled={username.trim().length < 2}>{t('common.add')}</button>
        </div>
        {msg && <p className="state-error-text" role="alert">{msg}</p>}
      </section>
      <section className="panel">
        <h2>{t('set.syncAndAnalyse')}</h2>
        <button className="btn btn-primary" onClick={run} disabled={st?.running || me.accounts.length === 0}>{st?.running ? t('set.syncing') : t('set.sync')}</button>
        {st?.message && <p role="status" className={st.error ? 'state-error-text' : 'muted'}>{st.error ?? st.message}</p>}
        <p className="muted">{t('set.queue', { done: num(by.done ?? 0), pending: num((by.pending ?? 0) + (by.running ?? 0)) })}{by.error ? ` · ${t('set.queueErr', { n: by.error })}` : ''}</p>
      </section>
      <section className="panel">
        <h2>{t('set.library')}</h2>
        <p className="muted">{lib.data?.status === 'done' ? t('set.libCount', { n: num(lib.data.count) }) : lib.data?.message || '…'}</p>
        {lib.data && lib.data.status !== 'done' && lib.data.status !== 'downloading' && (
          <button className="btn" onClick={() => api('/library/import', { method: 'POST', body: {} }).then(lib.reload)}>{t('pz.libStart')}</button>
        )}
      </section>
    </div>
  );
}
