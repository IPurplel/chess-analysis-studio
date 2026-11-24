import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from './Board';
import { api, useApi, CATEGORY_AR } from './api';

/* ----------------------------------------------------------- training puzzles from your own mistakes */
export function Train() {
  const { data, error, loading, reload } = useApi<any>('/puzzles/next');
  const [fen, setFen] = useState('');
  const [step, setStep] = useState(0);
  const [fb, setFb] = useState<null | { ok: boolean; text: string }>(null);
  const [done, setDone] = useState(false);
  const p = data?.puzzle;

  useEffect(() => { if (p) { setFen(p.fen); setStep(0); setFb(null); setDone(false); } }, [p?.id]);
  const orient = useMemo(() => (p ? (new Chess(p.fen).turn() === 'w' ? 'white' : 'black') : 'white'), [p?.id]);

  if (loading && !data) return <div className="skeleton" style={{ height: 480 }} aria-busy="true" />;
  if (error) return <div className="state state-error" role="alert"><h2>حدث خطأ</h2><p>{error}</p></div>;
  if (!p) return <div className="state"><h2>لا توجد تمارين مستحقة الآن</h2><p>تُبنى التمارين من أخطائك الفادحة والمتوسطة بعد تحليل مبارياتك. عد لاحقًا أو زامن مباريات جديدة.</p><a className="btn" href="#/settings">المزامنة</a></div>;

  const submit = async (correct: boolean) => { await api(`/puzzles/${p.id}/attempt`, { body: { correct } }); };
  const onMove = (uci: string) => {
    if (done) return;
    const expected = p.solution[step];
    const c = new Chess(fen);
    if (uci === expected) {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const reply = p.solution[step + 1];
      if (reply && step + 2 < p.solution.length) {
        c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
        setFen(c.fen()); setStep(step + 2); setFb({ ok: true, text: 'صحيح، أكمل.' });
      } else {
        setFen(c.fen()); setDone(true); setFb({ ok: true, text: 'أحسنت! وجدت أفضل نقلة.' }); submit(true);
      }
    } else {
      setFb({ ok: false, text: 'ليست أفضل نقلة. حاول مرة أخرى أو اعرض الحل.' });
      setFen(p.fen); setStep(0);
    }
  };
  const show = () => { const u = p.solution[step]; setFb({ ok: false, text: `الحل: ${u.slice(0, 2)} ← ${u.slice(2, 4)}` }); submit(false); setDone(true); };

  return (
    <div className="train">
      <div>
        <Board fen={fen} orientation={orient} interactive={!done} onMove={onMove}
          arrows={done && fb?.ok === false ? [{ from: p.solution[step].slice(0, 2), to: p.solution[step].slice(2, 4), brush: 'green' }] : []} />
      </div>
      <aside className="panel">
        <h1>تمرين من مباراتك</h1>
        <p>في هذه الوضعية لعبت نقلة وُصفت بـ <span className={`chip chip-${p.category}`}>{CATEGORY_AR[p.category]}</span>. أوجد الأفضل لـ{orient === 'white' ? 'الأبيض' : 'الأسود'}.</p>
        {p.game?.opening && <p className="muted">{p.game.opening}</p>}
        {fb && <p role="status" className={fb.ok ? 'fb-ok' : 'fb-bad'}>{fb.text}</p>}
        <div className="btnrow">
          {!done && <button className="btn" onClick={show}>اعرض الحل</button>}
          {done && <button className="btn btn-primary" onClick={reload}>التمرين التالي</button>}
          {p.game?.url && <a className="btn btn-quiet" href={p.game.url} target="_blank" rel="noreferrer">المباراة الأصلية</a>}
        </div>
      </aside>
    </div>
  );
}

/* ----------------------------------------------------------- play against a bot */
const LEVELS = [
  { elo: 500, name: 'مبتدئ' }, { elo: 800, name: 'سهل' }, { elo: 1100, name: 'متوسط مبكر' }, { elo: 1400, name: 'متوسط' },
  { elo: 1700, name: 'متقدم' }, { elo: 2000, name: 'قوي' }, { elo: 2400, name: 'خبير' }, { elo: 3190, name: 'أقصى قوة' },
];

export function Play({ myRating }: { myRating: number | null }) {
  const suggested = LEVELS.reduce((b, l) => (Math.abs(l.elo - ((myRating ?? 800) + 150)) < Math.abs(b.elo - ((myRating ?? 800) + 150)) ? l : b));
  const [elo, setElo] = useState(suggested.elo);
  const [side, setSide] = useState<'white' | 'black'>('white');
  const [fen, setFen] = useState(new Chess().fen());
  const hist = useRef<string[]>([new Chess().fen()]);
  const sans = useRef<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [last, setLast] = useState<[string, string] | null>(null);
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null);
  const [over, setOver] = useState('');

  const chess = new Chess(fen);
  const myTurn = chess.turn() === (side === 'white' ? 'w' : 'b');

  const apply = (uci: string) => {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    hist.current.push(c.fen()); sans.current.push(m.san);
    setFen(c.fen()); setLast([uci.slice(0, 2), uci.slice(2, 4)]); setHint(null);
    if (c.isCheckmate()) setOver(c.turn() === (side === 'white' ? 'w' : 'b') ? 'خسرت بكش مات' : 'كش مات — فزت!');
    else if (c.isDraw()) setOver('تعادل');
  };

  useEffect(() => {
    if (over || myTurn || thinking) return;
    setThinking(true);
    api('/bot/move', { body: { fen, elo } }).then((r) => { if (r.uci) apply(r.uci); }).finally(() => setThinking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, side, over]);

  const reset = (s = side) => { hist.current = [new Chess().fen()]; sans.current = []; setFen(new Chess().fen()); setLast(null); setOver(''); setHint(null); setSide(s); };
  const undo = () => {
    if (thinking || hist.current.length < 3) return;
    hist.current.splice(-2); sans.current.splice(-2);
    setFen(hist.current[hist.current.length - 1]); setLast(null); setOver(''); setHint(null);
  };
  const getHint = async () => { const r = await api('/bot/move', { body: { fen, elo: 3190 } }); if (r.uci) setHint({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4) }); };

  return (
    <div className="train">
      <div><Board fen={fen} orientation={side} lastMove={last} interactive={myTurn && !over && !thinking} onMove={apply}
        arrows={hint ? [{ ...hint, brush: 'green' }] : []} /></div>
      <aside className="panel">
        <h1>العب ضد بوت</h1>
        <label className="field"><span className="label">قوة البوت</span>
          <select value={elo} onChange={(e) => { setElo(+e.target.value); }}>{LEVELS.map((l) => <option key={l.elo} value={l.elo}>{l.name} — ~{l.elo}</option>)}</select></label>
        <p className="muted">اقتراح لتطورك: بوت أقوى منك بقليل ({suggested.name}).</p>
        <div className="btnrow">
          <button className="btn" onClick={() => reset('white')}>العب بالأبيض</button>
          <button className="btn" onClick={() => reset('black')}>العب بالأسود</button>
        </div>
        <div className="btnrow">
          <button className="btn" onClick={undo} disabled={thinking}>تراجع</button>
          <button className="btn" onClick={getHint} disabled={!myTurn || thinking || !!over}>تلميح</button>
        </div>
        <p role="status" className={over ? 'fb-ok' : 'muted'}>{over || (thinking ? 'البوت يفكر…' : myTurn ? 'دورك' : '')}</p>
        <p className="measured movesline" dir="ltr">{sans.current.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ')}</p>
        <small className="muted">بوتات أقل من 1320 تُحاكى بإضعاف Stockfish باختيار نقلات أضعف عشوائيًا.</small>
      </aside>
    </div>
  );
}
