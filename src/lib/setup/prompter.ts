import { createInterface } from 'node:readline';

export interface Choice<T> { value: T; label: string; hint?: string }
export const CANCEL: unique symbol = Symbol('burhan.cancel');
export interface Prompter {
  select<T>(message: string, choices: Choice<T>[], initial: T): Promise<T | typeof CANCEL>;
  text(message: string, initial: string, validate: (s: string) => string | undefined): Promise<string | typeof CANCEL>;
  note(text: string): void;
  /** Release the input stream when the wizard is done (the numbered prompter keeps stdin open). */
  close?(): void;
}

/** The @clack/prompts front end; null when the library cannot load (AC-08). */
export async function clackPrompter(): Promise<Prompter | null> {
  let c: typeof import('@clack/prompts');
  try { c = await import('@clack/prompts'); } catch { return null; }
  return {
    async select<T>(message: string, choices: Choice<T>[], initial: T) {
      const r = await c.select<T>({ message, options: choices.map((x) => ({ value: x.value, label: x.label, hint: x.hint })) as never, initialValue: initial });
      return c.isCancel(r) ? CANCEL : r;
    },
    async text(message, initial, validate) {
      const r = await c.text({ message, initialValue: initial, validate: (v) => validate(v ?? '') });
      return c.isCancel(r) ? CANCEL : r;
    },
    note: (t) => c.note(t),
  };
}

/** AC-08: a throw that is not a cancel (cancel is a return value) moves to the fallback for good and asks THE SAME question again. */
export function withFallback(primary: Prompter, fallback: () => Prompter): Prompter {
  let active: Prompter = primary;
  let swapped = false;
  const run = async <R>(f: (p: Prompter) => R | Promise<R>): Promise<R> => {
    try { return await f(active); }
    catch (e) { if (swapped) throw e; swapped = true; active = fallback(); return f(active); }
  };
  return {
    select: (m, c, i) => run((p) => p.select(m, c, i)),
    text: (m, i, v) => run((p) => p.text(m, i, v)),
    note: (t) => { try { active.note(t); } catch { if (swapped) throw new Error('note failed'); swapped = true; active = fallback(); active.note(t); } },
    close: () => { primary.close?.(); if (swapped) active.close?.(); },
  };
}

/** Plain numbered lists on node:readline: works on any terminal, and on piped input. An invalid number asks again; end of input = cancel. */
export function numberedPrompter(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Prompter & { close(): void } {
  const rl = createInterface({ input, terminal: false });
  const queue: string[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  rl.on('line', (l) => { queue.push(l); wake?.(); });
  rl.on('close', () => { ended = true; wake?.(); });
  const line = async (): Promise<string | null> => {
    while (queue.length === 0) {
      if (ended) return null;
      await new Promise<void>((r) => { wake = r; });
      wake = null;
    }
    return queue.shift() as string;
  };
  const say = (s: string): void => { output.write(s + '\n'); };
  return {
    async select<T>(message: string, choices: Choice<T>[], initial: T) {
      const at = Math.max(0, choices.findIndex((c) => c.value === initial));
      for (;;) {
        say(message);
        choices.forEach((c, i) => say(`  ${i + 1}) ${c.label}${c.hint ? ` — ${c.hint}` : ''}`));
        output.write(`Type a number (Enter = ${at + 1}): `);
        const l = await line();
        if (l === null) return CANCEL;
        const t = l.trim();
        if (t === '') return choices[at].value;
        const n = Number(t);
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;
        say(`Please type a number from 1 to ${choices.length}.`);
      }
    },
    async text(message, initial, validate) {
      for (;;) {
        output.write(`${message}${initial ? ` [${initial}]` : ''} `);
        const l = await line();
        if (l === null) return CANCEL;
        const v = l.trim() === '' ? initial : l.trim();
        const err = validate(v);
        if (err === undefined) return v;
        say(err);
      }
    },
    note: (t) => say(t),
    close: () => rl.close(),
  };
}

/** For tests: answers are consumed in order, one per select/text; CANCEL (or running out) cancels. `shown` records every message, choice label and note. */
export function scriptedPrompter(answers: unknown[]): Prompter & { shown: string[]; asked: string[] } {
  const rest = [...answers];
  const shown: string[] = [];
  const asked: string[] = [];
  return {
    shown, asked,
    async select<T>(message: string, choices: Choice<T>[]) {
      asked.push(message); shown.push(message, ...choices.map((c) => c.label + (c.hint ? ` ${c.hint}` : '')));
      return rest.length ? (rest.shift() as T | typeof CANCEL) : CANCEL;
    },
    async text(message, _initial, validate) {
      asked.push(message); shown.push(message);
      // A rejected answer is re-asked, as a real prompt does: the next scripted answer is the retry.
      while (rest.length) {
        const a = rest.shift();
        if (a === CANCEL) return CANCEL;
        const err = validate(a as string);
        if (err === undefined) return a as string;
        shown.push(err);
      }
      return CANCEL;
    },
    note: (t) => { shown.push(t); },
  };
}
