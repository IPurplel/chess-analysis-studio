import { useState } from 'react';
import { api, useApi, fmt1, pct, dateAr, CATEGORY_AR, CATEGORY_MARK, PHASE_AR, TC_AR } from './api';

export function Filters({ tc, color, set }: { tc: string; color: string; set: (k: string, v: string) => void }) {
  return (
    <div className="filters" role="group" aria-label="مرشحات">
      <label className="field"><span className="label">نوع اللعب</span>
        <select value={tc} onChange={(e) => set('tc', e.target.value)}>
          {['rapid', 'blitz', 'bullet', 'daily', 'all'].map((k) => <option key={k} value={k}>{TC_AR[k]}</option>)}
        </select></label>
      <label className="field"><span className="label">لونك</span>
        <select value={color} onChange={(e) => set('color', e.target.value)}>
          <option value="all">الكل</option><option value="w">الأبيض</option><option value="b">الأسود</option>
        </select></label>
    </div>
  );
}

function Loading() { return <div className="skeleton" style={{ height: 260 }} aria-busy="true" />; }
function ErrorBox({ msg }: { msg: string }) { return <div className="state state-error" role="alert"><h2>حدث خطأ</h2><p>{msg}</p></div>; }

function RatingChart({ points }: { points: { t: number; rating: number | null }[] }) {
  const pts = points.filter((p) => p.rating != null) as { t: number; rating: number }[];
  if (pts.length < 2) return <p className="muted">لا توجد بيانات كافية للرسم.</p>;
  const W = 600, H = 150;
  const min = Math.min(...pts.map((p) => p.rating)), max = Math.max(...pts.map((p) => p.rating));
  const span = Math.max(40, max - min);
  const line = pts.map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 10 - ((p.rating - min) / span) * (H - 20)).toFixed(1)}`).join(' ');
  return (
    <figure className="chartfig">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="linechart" role="img" aria-label="تطور التصنيف">
        <polyline points={line} className="linechart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="muted"><span className="measured">{min}</span> إلى <span className="measured">{max}</span> · من {dateAr(pts[0].t)} إلى {dateAr(pts[pts.length - 1].t)}</figcaption>
    </figure>
  );
}

export function Dashboard({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid', color = q.get('color') ?? 'all';
  const { data, error, loading } = useApi<any>(`/stats?tc=${tc}&color=${color}`);
  const an = useApi<any>('/analysis/status');
  return (
    <div className="stack">
      <div className="pagehead"><h1>لوحة أدائك</h1><Filters tc={tc} color={color} set={setQ} /></div>
      {loading && !data ? <Loading /> : error ? <ErrorBox msg={error} /> : data && (() => {
        const t = data.totals;
        if (!t.games) return (
          <div className="state"><h2>لا توجد مباريات بعد</h2><p>اربط حسابك من «الإعدادات» ثم اضغط مزامنة، وسيبدأ المحرك بالتحليل تلقائيًا.</p><a className="btn btn-primary" href="#/settings">اذهب إلى الإعدادات</a></div>
        );
        const pending = (an.data?.byStatus?.pending ?? 0) + (an.data?.byStatus?.running ?? 0);
        return (
          <>
            {pending > 0 && <div className="note" role="status">المحرك يحلل {pending} مباراة في الخلفية؛ الأرقام أدناه تُحدَّث كلما اكتمل تحليل مباراة (حُلّل {t.analysed} من {t.games}).</div>}
            <div className="readings">
              <div className="panel reading-card"><span className="label">رائعة (Brilliant)</span><span className="reading">{t.brilliant}</span><span className="label"><span className="measured">{fmt1(t.brilliantPerGame, 2)}</span> لكل مباراة</span></div>
              <div className="panel reading-card"><span className="label">أخطاء فادحة (Blunders)</span><span className="reading bad">{t.blunder}</span><span className="label"><span className="measured">{fmt1(t.blunderPerGame, 2)}</span> لكل مباراة</span></div>
              <div className="panel reading-card"><span className="label">متوسط الدقة</span><span className="reading">{fmt1(t.avgAccuracy, 0)}<small>%</small></span><span className="label">من <span className="measured">{t.analysed}</span> مباراة محللة</span></div>
              <div className="panel reading-card"><span className="label">نتائجك</span><span className="reading">{t.W}<small>/{t.D}/{t.L}</small></span><span className="label">فوز / تعادل / خسارة من <span className="measured">{t.games}</span></span></div>
            </div>

            <div className="split">
              <section className="panel">
                <h2>تطور التصنيف</h2>
                <RatingChart points={data.timeline} />
              </section>
              <section className="panel">
                <h2>دقتك حسب المرحلة</h2>
                <table className="table"><thead><tr><th>المرحلة</th><th className="num">الدقة</th></tr></thead>
                  <tbody>{(['opening', 'middlegame', 'endgame'] as const).map((p) => (
                    <tr key={p}><td>{PHASE_AR[p]}</td><td className="num measured">{data.phases[p] != null ? fmt1(data.phases[p], 0) + '%' : '—'}</td></tr>))}</tbody></table>
              </section>
            </div>

            {data.timePressure.games > 0 && (() => {
              const tp = data.timePressure;
              const rate = (b: { moves: number; blunders: number }) => (b.moves ? (100 * b.blunders) / b.moves : null);
              return (
                <section className="panel">
                  <h2>الوقت وأخطاؤك</h2>
                  <table className="table"><thead><tr><th>الحالة</th><th className="num">نقلاتك</th><th className="num">أخطاء فادحة</th><th className="num">النسبة</th></tr></thead>
                    <tbody>
                      <tr><td>وقت كافٍ</td><td className="num measured">{tp.normal.moves}</td><td className="num measured">{tp.normal.blunders}</td><td className="num measured">{fmt1(rate(tp.normal), 1)}%</td></tr>
                      <tr><td>أقل من 10% من وقتك الأصلي</td><td className="num measured">{tp.trouble.moves}</td><td className="num measured">{tp.trouble.blunders}</td><td className="num measured">{fmt1(rate(tp.trouble), 1)}%</td></tr>
                    </tbody></table>
                  <p className="muted">خسرت على الوقت <span className="measured">{tp.timeoutLosses}</span> من <span className="measured">{tp.losses}</span> خسارة.</p>
                </section>
              );
            })()}

            <section className="panel">
              <h2>جودة نقلاتك</h2>
              <div className="catgrid">
                {['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'].map((c) => (
                  <div key={c} className="catcell"><span className={`chip chip-${c}`}>{CATEGORY_MARK[c]} {CATEGORY_AR[c]}</span><span className="measured">{t[c]}</span></div>
                ))}
              </div>
            </section>
          </>
        );
      })()}
    </div>
  );
}

export function Games({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid', color = q.get('color') ?? 'all';
  const { data, error, loading } = useApi<any>(`/games?tc=${tc}&color=${color}&limit=200`);
  return (
    <div className="stack">
      <div className="pagehead"><h1>مبارياتي</h1><Filters tc={tc} color={color} set={setQ} /></div>
      {loading && !data ? <Loading /> : error ? <ErrorBox msg={error} /> : data && (
        data.games.length === 0 ? <div className="state"><h2>لا توجد مباريات</h2><p>غيّر المرشحات أو زامن حسابك.</p></div> :
        <div className="panel tablewrap">
          <table className="table">
            <thead><tr><th>التاريخ</th><th>الخصم</th><th>الافتتاحية</th><th className="num">الدقة</th><th className="num">رائعة</th><th className="num">خطأ فادح</th><th>النتيجة</th></tr></thead>
            <tbody>
              {data.games.map((g: any) => (
                <tr key={g.id} className="rowlink">
                  <td className="measured">{dateAr(g.played_at)}</td>
                  <td><a href={`#/review/${g.id}`}>{g.color === 'w' ? g.black : g.white}</a> <small className="measured muted">{g.color === 'w' ? g.black_rating : g.white_rating}</small></td>
                  <td>{g.opening || '—'}</td>
                  <td className="num measured">{g.accuracy != null ? fmt1(g.accuracy, 0) + '%' : g.status === 'running' ? '…' : '—'}</td>
                  <td className="num measured">{g.accuracy != null ? g.counts.brilliant ?? 0 : '—'}</td>
                  <td className="num measured">{g.accuracy != null ? g.counts.blunder ?? 0 : '—'}</td>
                  <td><span className={`chip chip-res-${g.result}`}>{g.result === 'W' ? 'فوز' : g.result === 'L' ? 'خسارة' : 'تعادل'}</span></td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Openings({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid', color = q.get('color') ?? 'all';
  const [min, setMin] = useState(2);
  const { data, error, loading } = useApi<any>(`/stats?tc=${tc}&color=${color}`);
  const rows = (data?.openings ?? []).filter((o: any) => o.n >= min);
  return (
    <div className="stack">
      <div className="pagehead"><h1>افتتاحياتك</h1>
        <div className="filters">
          <Filters tc={tc} color={color} set={setQ} />
          <label className="field"><span className="label">الحد الأدنى للمباريات</span>
            <select value={min} onChange={(e) => setMin(+e.target.value)}>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
        </div>
      </div>
      <p className="muted">الأسماء ورموز ECO من قاعدة lichess. النقاط = (فوز + نصف التعادل) ÷ المباريات. العيّنات الصغيرة لا تثبت شيئًا.</p>
      {loading && !data ? <Loading /> : error ? <ErrorBox msg={error} /> : rows.length === 0 ? <div className="state"><h2>لا توجد افتتاحيات بهذا الحد</h2><p>خفّض الحد الأدنى للمباريات.</p></div> : (
        <div className="panel tablewrap">
          <table className="table">
            <thead><tr><th>الافتتاحية</th><th>اللون</th><th className="num">مباريات</th><th className="num">فوز</th><th className="num">تعادل</th><th className="num">خسارة</th><th className="num">النقاط</th><th className="num">الدقة</th><th className="num">أخطاء/مباراة</th><th className="num">نقلات النظرية</th></tr></thead>
            <tbody>{rows.map((o: any) => (
              <tr key={o.color + o.name}>
                <td>{o.name} <small className="measured muted">{o.eco}</small></td>
                <td>{o.color === 'w' ? 'الأبيض' : 'الأسود'}</td>
                <td className="num measured">{o.n}</td><td className="num measured">{o.W}</td><td className="num measured">{o.D}</td><td className="num measured">{o.L}</td>
                <td className="num measured"><div className="scorebar"><div style={{ inlineSize: pct(o.score) }} /></div>{pct(o.score)}</td>
                <td className="num measured">{o.accuracy != null ? fmt1(o.accuracy, 0) + '%' : '—'}</td>
                <td className="num measured">{o.blundersPerGame != null ? fmt1(o.blundersPerGame, 1) : '—'}</td>
                <td className="num measured">{fmt1(o.avgTheoryPlies, 1)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Coach({ q, setQ }: { q: URLSearchParams; setQ: (k: string, v: string) => void }) {
  const tc = q.get('tc') ?? 'rapid';
  const { data, error, loading } = useApi<any>(`/coach?tc=${tc}`);
  return (
    <div className="stack">
      <div className="pagehead"><h1>مدربك الشخصي</h1><Filters tc={tc} color="all" set={(k, v) => k === 'tc' && setQ(k, v)} /></div>
      {loading && !data ? <Loading /> : error ? <ErrorBox msg={error} /> : data && (
        <>
          <section className="panel coachhead">
            <div><span className="label">تصنيفك الحالي في chess.com ({TC_AR[tc]})</span>
              <span className="reading">{data.rating ?? '—'}</span>
              <span className="label">{data.band ? data.band.label : 'اربط حساب chess.com لنقرأ تصنيفك'}</span></div>
            <div><span className="label">تمارين أخطائك المستحقة اليوم</span><span className="reading">{data.puzzles.due}</span><a className="btn btn-primary" href="#/train">ابدأ التمارين</a></div>
          </section>

          <section className="panel">
            <h2>ما الذي يجب أن تركز عليه</h2>
            <p className="muted">مبني على {data.basedOn.analysedGames} مباراة محللة من {data.basedOn.totalGames}.</p>
            <p className="muted">التمارين الحالية مبنية على أخطائك أنت فقط؛ مكتبة تمارين خارجية حسب تصنيفك لم تُضف بعد.</p>
            <ol className="focuslist">
              {data.focus.map((f: any, i: number) => (
                <li key={i} className={`focus focus-${f.severity}`}>
                  <h3>{f.title}</h3><p>{f.why}</p><p><b>المطلوب:</b> {f.action}</p>
                </li>))}
            </ol>
          </section>

          {data.openings && (
            <section className="panel">
              <h2>الافتتاحيات</h2>
              <div className="split">
                <div><h3>تلعبها جيدًا</h3>{data.openings.keep.length ? <ul className="plain">{data.openings.keep.map((o: any) => <li key={o.color + o.name}>{o.name} ({o.color === 'w' ? 'أبيض' : 'أسود'}) — <span className="measured">{pct(o.score)}</span> من <span className="measured">{o.n}</span></li>)}</ul> : <p className="muted">لا توجد عيّنة كافية (4 مباريات أو أكثر).</p>}</div>
                <div><h3>تحتاج إصلاحًا</h3>{data.openings.fix.length ? <ul className="plain">{data.openings.fix.map((o: any) => <li key={o.color + o.name}>{o.name} ({o.color === 'w' ? 'أبيض' : 'أسود'}) — <span className="measured">{pct(o.score)}</span> من <span className="measured">{o.n}</span></li>)}</ul> : <p className="muted">لا توجد افتتاحية ضعيفة بعيّنة كافية.</p>}</div>
              </div>
              <h3>مقترحة لمستواك</h3>
              <p>بالأبيض: <b>{data.openings.suggestWhite.join('، ')}</b> · بالأسود: <b>{data.openings.suggestBlack.join('، ')}</b></p>
              <p className="muted">{data.openings.note}</p>
            </section>
          )}

          <section className="panel">
            <h2>خطتك الأسبوعية</h2>
            <ul className="plain">{data.weekly.map((w: string) => <li key={w}>{w}</li>)}</ul>
          </section>
        </>
      )}
    </div>
  );
}

export function Settings({ me, reloadMe }: { me: any; reloadMe: () => void }) {
  const [provider, setProvider] = useState('chesscom');
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState('');
  const sync = useApi<any>('/sync/status');
  const an = useApi<any>('/analysis/status');
  const add = async () => {
    setMsg('');
    try { await api('/accounts', { body: { provider, username: username.trim() } }); setUsername(''); reloadMe(); }
    catch (e: any) { setMsg(e.message); }
  };
  const run = async () => { await api('/sync', { method: 'POST', body: {} }); const t = setInterval(() => { sync.reload(); an.reload(); }, 2000); setTimeout(() => clearInterval(t), 120000); sync.reload(); };
  const st = sync.data;
  const by = an.data?.byStatus ?? {};
  return (
    <div className="stack narrow">
      <h1>الإعدادات</h1>
      <section className="panel">
        <h2>حساباتك</h2>
        {me.accounts.length === 0 ? <p className="muted">لم تربط أي حساب بعد.</p> : (
          <ul className="plain">{me.accounts.map((a: any) => (
            <li key={a.provider + a.username} className="acctrow"><span>{a.provider === 'chesscom' ? 'chess.com' : 'lichess'} — <b className="measured">{a.username}</b></span>
              <button className="btn btn-quiet" onClick={() => api(`/accounts/${a.provider}/${a.username}`, { method: 'DELETE' }).then(reloadMe)}>إزالة</button></li>))}</ul>)}
        <div className="addrow">
          <label className="field"><span className="label">المنصة</span><select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="chesscom">chess.com</option><option value="lichess">lichess</option></select></label>
          <label className="field grow"><span className="label">اسم المستخدم</span><input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
          <button className="btn btn-primary" onClick={add} disabled={username.trim().length < 2}>إضافة</button>
        </div>
        {msg && <p className="state-error-text" role="alert">{msg}</p>}
      </section>
      <section className="panel">
        <h2>المزامنة والتحليل</h2>
        <button className="btn btn-primary" onClick={run} disabled={st?.running || me.accounts.length === 0}>{st?.running ? 'جارٍ الجلب…' : 'مزامنة المباريات'}</button>
        {st?.message && <p role="status" className={st.error ? 'state-error-text' : 'muted'}>{st.error ?? st.message}</p>}
        <p className="muted">طابور التحليل: <span className="measured">{by.done ?? 0}</span> مكتملة · <span className="measured">{(by.pending ?? 0) + (by.running ?? 0)}</span> بالانتظار{by.error ? <> · <span className="measured">{by.error}</span> أخطاء</> : null}</p>
      </section>
    </div>
  );
}
