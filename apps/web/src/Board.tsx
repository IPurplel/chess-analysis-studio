import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess } from 'chess.js';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

export function legalDests(fen: string): Map<Key, Key[]> {
  const c = new Chess(fen);
  const d = new Map<Key, Key[]>();
  for (const m of c.moves({ verbose: true })) {
    const a = d.get(m.from as Key) ?? [];
    a.push(m.to as Key);
    d.set(m.from as Key, a);
  }
  return d;
}

export interface BoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  lastMove?: [string, string] | null;
  arrows?: { from: string; to: string; brush: 'green' | 'red' | 'blue' }[];
  interactive?: boolean; // allow the side to move to play
  onMove?: (uci: string) => void;
}

/** Chessground wrapper. The board itself is always left-to-right even on an RTL page. */
export function Board({ fen, orientation = 'white', lastMove, arrows = [], interactive = false, onMove }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const cg = useRef<Api | null>(null);
  const cb = useRef(onMove);
  cb.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    cg.current = Chessground(el.current, { coordinates: true, animation: { duration: 180 }, highlight: { lastMove: true, check: true } });
    return () => cg.current?.destroy();
  }, []);

  useEffect(() => {
    const api = cg.current;
    if (!api) return;
    let chess: Chess;
    try { chess = new Chess(fen); } catch { return; } // never let a bad position take the page down
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    api.set({
      fen,
      orientation,
      turnColor: turn,
      check: chess.inCheck(),
      lastMove: (lastMove ?? undefined) as [Key, Key] | undefined,
      viewOnly: !interactive,
      movable: {
        free: false,
        color: interactive ? turn : undefined,
        dests: interactive ? legalDests(fen) : new Map(),
        showDests: true,
        events: {
          after: (from, to) => {
            const piece = chess.get(from as any);
            const promo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : '';
            cb.current?.(from + to + promo);
          },
        },
      },
      drawable: { enabled: false, visible: true, autoShapes: arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush })) },
    });
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], interactive, JSON.stringify(arrows)]);

  return <div className="board-wrap"><div ref={el} className="board" dir="ltr" /></div>;
}
