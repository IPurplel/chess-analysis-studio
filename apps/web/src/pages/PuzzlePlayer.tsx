import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from '../Board';
import { t } from '../i18n';
import { themeName } from '../api';

export interface PuzzleData {
  id: string | number;
  fen: string; // position the solver sees (any setup move already played)
  orientation: 'white' | 'black';
  solution: string[]; // UCI; even indices are the solver's moves, odd ones the forced replies
  setup?: [string, string] | null;
  themes?: string[];
}
export interface PuzzleResult { solved: boolean; hints: number; ms: number }

const sq = (u: string) => [u.slice(0, 2), u.slice(2, 4)] as const;

/** One puzzle. Remount with `key={puzzle.id}`; the first decisive event is reported once via onResult. */
export function PuzzlePlayer({ puzzle, onResult, onNext }: { puzzle: PuzzleData; onResult: (r: PuzzleResult) => void; onNext: () => void }) {
  const [fen, setFen] = useState(puzzle.fen);
  const [step, setStep] = useState(0);
  const [hints, setHints] = useState(0); // total hints used (affects the rating)
  const [stepHint, setStepHint] = useState(0); // hint level shown for the current step only
  const [wrong, setWrong] = useState(false);
  const [status, setStatus] = useState<'play' | 'solved' | 'revealed'>('play');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [last, setLast] = useState<[string, string] | null>(puzzle.setup ?? null);
  const [nonce, setNonce] = useState(0);
  const reported = useRef(false);
  const t0 = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const report = (solved: boolean) => {
    if (reported.current) return;
    reported.current = true;
    onResult({ solved, hints, ms: Date.now() - t0.current });
  };
  const play = (c: Chess, u: string) => { const [a, b] = sq(u); c.move({ from: a, to: b, promotion: u[4] }); setLast([a, b]); };

  const onMove = (uci: string) => {
    if (status !== 'play') return;
    if (uci === puzzle.solution[step]) {
      const c = new Chess(fen);
      play(c, uci);
      setFen(c.fen());
      if (step + 1 >= puzzle.solution.length) {
        setStatus('solved'); setMsg({ tone: 'ok', text: wrong ? t('pz.solvedHint') : t(hints ? 'pz.solvedHint' : 'pz.solved') });
        if (!wrong) report(true);
        return;
      }
      setMsg({ tone: 'info', text: t('pz.correctStep') });
      timer.current = setTimeout(() => {
        const c2 = new Chess(c.fen());
        play(c2, puzzle.solution[step + 1]);
        setFen(c2.fen());
        setStep(step + 2);
        setStepHint(0);
        setStepHint(0);
        if (step + 2 >= puzzle.solution.length) { setStatus('solved'); setMsg({ tone: 'ok', text: t('pz.solved') }); if (!wrong) report(true); }
      }, 450);
    } else {
      setWrong(true);
      report(false);
      setMsg({ tone: 'bad', text: t('pz.wrong') });
      setNonce((n) => n + 1); // snap the piece back
    }
  };

  const reveal = () => { report(false); setStatus('revealed'); setMsg({ tone: 'bad', text: t('pz.failed') }); };
  const expected = puzzle.solution[step];
  const arrows = [] as { from: string; to?: string; brush: 'green' | 'blue' }[];
  if (status === 'revealed' && expected) arrows.push({ from: sq(expected)[0], to: sq(expected)[1], brush: 'green' });
  else if (stepHint >= 1 && expected) arrows.push(stepHint >= 2 ? { from: sq(expected)[0], to: sq(expected)[1], brush: 'blue' } : { from: sq(expected)[0], brush: 'blue' });

  return (
    <div className="train">
      <Board fen={fen} orientation={puzzle.orientation} lastMove={last} interactive={status === 'play'} onMove={onMove} arrows={arrows} nonce={nonce} />
      <aside className="panel puzzle-side">
        <p>{t('pz.yourTurn', { side: t(puzzle.orientation === 'white' ? 'common.white' : 'common.black') })}</p>
        {puzzle.themes && status !== 'play' && (
          <p className="chips">{puzzle.themes.slice(0, 4).map((x) => <span key={x} className="chip">{themeName(x)}</span>)}</p>
        )}
        {msg && <p role="status" className={`fb fb-${msg.tone}`}>{msg.text}</p>}
        <div className="btnrow">
          {status === 'play' && <button className="btn" disabled={stepHint >= 2} onClick={() => { setHints((h) => h + 1); setStepHint((h) => h + 1); }}>{t('pz.hint')}{stepHint ? ` (${stepHint}/2)` : ''}</button>}
          {status === 'play' && <button className="btn btn-quiet" onClick={reveal}>{t('pz.solution')}</button>}
          {status !== 'play' && <button className="btn btn-primary" onClick={onNext} autoFocus>{t('pz.next')}</button>}
        </div>
      </aside>
    </div>
  );
}
