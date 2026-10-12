import type { Io } from '../src/main.js';

/** An Io that records what a command printed. */
export function capture(cwd = process.cwd()): { o: { out: string; err: string }; io: Io } {
  const o = { out: '', err: '' };
  return { o, io: { stdout: (s) => { o.out += s; }, stderr: (s) => { o.err += s; }, cwd } };
}
