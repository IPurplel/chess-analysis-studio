import { useRef, useState } from 'react';
import { api, catName, fmt1 } from '../api';
import { t } from '../i18n';

export interface Judge {
  san: string; category: string; kind: string | null; loss: number; accuracy: number; winBefore: number; winAfter: number;
  best: { uci: string; san: string | null; line: string[] } | null;
  top: { san: string; line: string[]; win: number; cp: number; mate: number | null }[];
  reply: { line: string[]; mate: number | null } | null;
}
export type JudgeState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; judge: Judge };

/** Ask the server's engine to judge a move; stale answers (a newer request was made) are dropped. */
export function useJudge() {
  const [state, setState] = useState<JudgeState>({ status: 'idle' });
  const seq = useRef(0);
  const run = (fen: string, uci: string) => {
    const mine = ++seq.current;
    setState({ status: 'loading' });
    api<Judge>('/judge', { body: { fen, uci } })
      .then((judge) => mine === seq.current && setState({ status: 'done', judge }))
      .catch((e) => mine === seq.current && setState({ status: 'error', message: e.status === 503 ? t('judge.unavailable') : e.message }));
  };
  const clear = () => { seq.current++; setState({ status: 'idle' }); };
  return { state, run, clear };
}

const evalText = (cp: number, mate: number | null) => (mate ? `#${mate}` : `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`);

/** The "game review" for a single move: what happened, why, and what the engine prefers. */
export function JudgeCard({ state, note }: { state: JudgeState; note?: string }) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <div className="panel inner judge" role="status" aria-busy="true"><p className="muted">{t('judge.playing')}</p></div>;
  if (state.status === 'error') return <div className="panel inner judge" role="alert"><p className="state-error-text">{state.message}</p></div>;
  const j = state.judge;
  const bad = ['inaccuracy', 'mistake', 'blunder'].includes(j.category);
  return (
    <div className="panel inner judge" role="status">
      <h3>{t('judge.title')}</h3>
      {note && <p className="muted">{note}</p>}
      <p>
        <b className="measured" dir="ltr">{t('judge.you', { san: j.san })}</b>{' '}
        <span className={`chip chip-${j.category}`}>{catName(j.category)}</span>{' '}
        <span className="muted">{bad ? t('judge.lost', { n: fmt1(j.loss, 0) }) : t('judge.fine')}</span>
      </p>
      {j.kind && bad && <p>{t('judge.why.' + j.kind)} <span className="muted">{t('judge.principle')}: {t('kind.hint.' + j.kind)}</span></p>}
      {j.best && j.best.uci && bad && (
        <p>{t('judge.best', { san: j.best.san ?? '' })} <span className="measured muted" dir="ltr">{j.best.line.join(' ')}</span></p>
      )}
      {j.reply && j.reply.line.length > 0 && bad && <p className="muted">{t('judge.reply')}: <span className="measured" dir="ltr">{j.reply.line.join(' ')}</span></p>}
      {j.top.length > 0 && (
        <details>
          <summary>{t('judge.top')}</summary>
          <ul className="plain">
            {j.top.map((l, i) => (
              <li key={i} className="measured" dir="ltr"><b>{l.san}</b> {evalText(l.cp, l.mate)} · {l.line.join(' ')}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
