import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { DATA_DIR } from './db.js';
import type { EngineLine, PositionEval } from '@studio/core';

export function stockfishPath(): string {
  if (process.env.STOCKFISH_PATH) return process.env.STOCKFISH_PATH;
  const win = `${DATA_DIR}/bin/sf-win/stockfish/stockfish-windows-x86-64-universal.exe`;
  if (process.platform === 'win32' && existsSync(win)) return win;
  const lin = `${DATA_DIR}/bin/stockfish`;
  if (existsSync(lin)) return lin;
  return 'stockfish'; // from PATH
}

/** Parse one UCI `info` line into an EngineLine (or null when it carries no usable score). */
export function parseInfo(line: string): (EngineLine & { depth: number }) | null {
  if (!line.startsWith('info ') || !line.includes(' pv ') || line.includes('lowerbound') || line.includes('upperbound')) return null;
  const t = line.split(/\s+/);
  let depth = 0, multipv = 1, cp: number | undefined, mate: number | undefined;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] === 'depth') depth = +t[++i];
    else if (t[i] === 'multipv') multipv = +t[++i];
    else if (t[i] === 'score') {
      const kind = t[++i];
      const v = +t[++i];
      if (kind === 'cp') cp = v;
      else if (kind === 'mate') mate = v;
    } else if (t[i] === 'pv') {
      pv = t.slice(i + 1);
      break;
    }
  }
  if (cp === undefined && mate === undefined) return null;
  return { depth, multipv, cp, mate, pv };
}

export interface GoOptions {
  movetime?: number;
  depth?: number;
  multipv?: number;
}

export class UciEngine {
  private proc: ChildProcessWithoutNullStreams;
  private listeners = new Set<(line: string) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private currentMultipv = 0;
  readonly name: string;

  constructor(path = stockfishPath(), private opts: { threads?: number; hash?: number } = {}) {
    this.proc = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.name = path;
    createInterface({ input: this.proc.stdout }).on('line', (l) => this.listeners.forEach((f) => f(l)));
    this.proc.on('error', (e) => this.listeners.forEach((f) => f('__error ' + e.message)));
  }

  private send(cmd: string) {
    this.proc.stdin.write(cmd + '\n');
  }

  private waitFor(pred: (line: string) => boolean, timeoutMs = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(fn); reject(new Error('engine timeout')); }, timeoutMs);
      const fn = (line: string) => {
        if (line.startsWith('__error')) { clearTimeout(timer); this.listeners.delete(fn); reject(new Error(line)); return; }
        if (pred(line)) { clearTimeout(timer); this.listeners.delete(fn); resolve(line); }
      };
      this.listeners.add(fn);
    });
  }

  async init(): Promise<void> {
    const ready = this.waitFor((l) => l === 'uciok', 20000);
    this.send('uci');
    await ready;
    this.send(`setoption name Threads value ${this.opts.threads ?? 1}`);
    this.send(`setoption name Hash value ${this.opts.hash ?? 64}`);
    const r = this.waitFor((l) => l === 'readyok', 20000);
    this.send('isready');
    await r;
  }

  /** Queue a UCI option change so it applies between analysis jobs. */
  setOption(name: string, value: string | number | boolean): Promise<void> {
    const job = this.chain.then(() => this.send(`setoption name ${name} value ${value}`));
    this.chain = job.catch(() => {});
    return job;
  }

  /** Jobs on one engine run strictly one after another. */
  analyze(fen: string, go: GoOptions = {}): Promise<PositionEval> {
    const job = this.chain.then(() => this.run(fen, go));
    this.chain = job.catch(() => {});
    return job;
  }

  private async run(fen: string, go: GoOptions): Promise<PositionEval> {
    const mpv = go.multipv ?? 3;
    if (mpv !== this.currentMultipv) {
      this.send(`setoption name MultiPV value ${mpv}`);
      this.currentMultipv = mpv;
    }
    const best = new Map<number, EngineLine & { depth: number }>();
    const collect = (line: string) => {
      const p = parseInfo(line);
      if (p && (!best.has(p.multipv) || p.depth >= best.get(p.multipv)!.depth)) best.set(p.multipv, p);
    };
    this.listeners.add(collect);
    try {
      this.send('ucinewgame');
      this.send(`position fen ${fen}`);
      const done = this.waitFor((l) => l.startsWith('bestmove'), (go.movetime ?? 5000) + 30000);
      this.send(go.depth ? `go depth ${go.depth}` : `go movetime ${go.movetime ?? 250}`);
      await done;
    } finally {
      this.listeners.delete(collect);
    }
    const lines = [...best.values()].sort((a, b) => a.multipv - b.multipv).map(({ depth: _d, ...l }) => l);
    const depth = Math.max(0, ...[...best.values()].map((l) => l.depth));
    return { depth, lines };
  }

  quit() {
    try { this.send('quit'); } catch {}
    setTimeout(() => this.proc.kill(), 500);
  }
}

export class EnginePool {
  private engines: UciEngine[] = [];
  private rr = 0;
  static defaultSize() {
    // capped at 4 by default: small LXC containers have little RAM; raise it with ENGINE_WORKERS.
    return Math.max(1, Number(process.env.ENGINE_WORKERS) || Math.min(4, os.cpus().length - 1));
  }
  async start(n = EnginePool.defaultSize()) {
    for (let i = 0; i < n; i++) {
      const e = new UciEngine(stockfishPath(), { threads: 1, hash: 64 });
      await e.init();
      this.engines.push(e);
    }
    return this;
  }
  get size() { return this.engines.length; }
  analyze(fen: string, go?: GoOptions) {
    const e = this.engines[this.rr++ % this.engines.length];
    return e.analyze(fen, go);
  }
  stop() { this.engines.forEach((e) => e.quit()); this.engines = []; }
}
