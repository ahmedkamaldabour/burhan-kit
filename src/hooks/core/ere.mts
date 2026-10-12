/** POSIX ERE, as GNU grep -E reads it under a glibc UTF-8 locale — for the users' WF_*_REGEX values and the
 *  kit's own patterns (spec D3). Semantics are measured against GNU grep 3.12 (test/hooks/ere.test.ts).
 *
 *  Matching runs on a Thompson NFA, in time linear in the text, like grep's DFA, and every match has a
 *  work budget: no pattern can make a hook hang (QC P1). Refused, so the check stays silent (doctor names
 *  them): back-references (they need backtracking) and patterns over MAX_STATES. Lines are matched one by
 *  one, as grep does: nothing matches across a newline. */

// ---------------------------------------------------------------- character classes (glibc UTF-8, measured)
const SPACE_CHARS = '\\t\\v\\f\\r\\u{20}\\u{1680}\\u{2000}-\\u{2006}\\u{2008}-\\u{200a}\\u{2028}\\u{2029}\\u{205f}\\u{3000}';
const BLANK_CHARS = '\\t\\u{20}\\u{1680}\\u{2000}-\\u{2006}\\u{2008}-\\u{200a}\\u{205f}\\u{3000}';
const ALNUM = '[\\p{L}\\p{M}\\p{Nl}\\p{Nd}]';
const GRAPH = `[^\\p{Cc}\\p{Cn}\\p{Cs}${SPACE_CHARS}]`;
const CLASSES: Record<string, string> = {
  alpha: '[[\\p{L}\\p{M}\\p{Nl}\\p{Nd}]--[0-9]]',
  digit: '[0-9]',
  alnum: ALNUM,
  upper: '[\\p{Uppercase}\\p{Lt}]',
  lower: '[\\p{Lowercase}\\p{Lt}]',
  space: `[${SPACE_CHARS}]`,
  blank: `[${BLANK_CHARS}]`,
  cntrl: '[\\p{Cc}\\u{2028}\\u{2029}]',
  xdigit: '[0-9A-Fa-f]',
  graph: GRAPH,
  print: `[${GRAPH}${BLANK_CHARS}]`,
  punct: `[${GRAPH}--${ALNUM}]`,
};
const WORD = `[_${ALNUM}]`;
const RE_DUP_MAX = 32767;
const MAX_STATES = 2_000;      // `.{1000}` fits; `.{30000}` does not
// Work per match: a base plus a share per character, so the time stays linear in the text (a long heredoc
// command still matches) while an oversized pattern stops early. Over it, the answer is "no match".
const MAX_STEPS = 5_000_000;
const STEPS_PER_CHAR = 32;

const U = (cp: number): string => `\\u{${cp.toString(16)}}`;
const lit = (ch: string): string => U(ch.codePointAt(0)!);

class Invalid extends Error {}
class OverBudget extends Error {}

// ---------------------------------------------------------------- syntax tree
type Assertion = 'bol' | 'eol' | 'wordb' | 'nwordb' | 'wstart' | 'wend';
type Node =
  | { k: 'empty' }
  | { k: 'set'; cls: string }                    // one character: a v-flag class or an escaped literal
  | { k: 'assert'; a: Assertion }
  | { k: 'cat'; xs: Node[] }
  | { k: 'alt'; xs: Node[] }
  | { k: 'rep'; x: Node; min: number; max: number } // max: Infinity = unbounded
  | { k: 'group'; x: Node; n: number };

const EMPTY: Node = { k: 'empty' };
const ANY_BUT_NEWLINE = '[^\\n]';

/** One bracket expression at s[i] === '[': [v-flag class, index after it]. */
function bracket(s: string, i: number): [string, number] {
  let j = i + 1;
  let neg = false;
  if (s[j] === '^') { neg = true; j++; }
  // `[:alpha:]` outside a bracket is an error in GNU grep ("character class syntax is [[:space:]]").
  if (s[j] === ':') { const end = s.indexOf(']', j + 1); if (end > j && s[end - 1] === ':') throw new Invalid('[:class:] outside brackets'); }
  const items: string[] = [];
  let first = true;
  let prevWasRangeEnd = false;
  const atom = (): [string, number] => { // [class, code point or -1]
    if (s[j] === '[' && (s[j + 1] === ':' || s[j + 1] === '.' || s[j + 1] === '=')) {
      const kind = s[j + 1];
      const end = s.indexOf(kind + ']', j + 2);
      if (end < 0) throw new Invalid('unterminated [' + kind);
      const name = s.slice(j + 2, end);
      j = end + 2;
      if (kind === ':') {
        const c = CLASSES[name];
        if (!c) throw new Invalid('unknown class ' + name);
        return [c, -1];
      }
      const cps = [...name];
      if (cps.length !== 1) throw new Invalid('collating element');
      return [lit(cps[0]), cps[0].codePointAt(0)!];
    }
    const ch = String.fromCodePoint(s.codePointAt(j)!);
    j += ch.length;
    return [lit(ch), ch.codePointAt(0)!];
  };
  for (;;) {
    if (j >= s.length) throw new Invalid('unterminated [');
    if (s[j] === ']' && !first) { j++; break; }
    first = false;
    if (s[j] === '-' && prevWasRangeEnd && s[j + 1] !== ']') throw new Invalid('invalid range end'); // [a-c-e]
    prevWasRangeEnd = false;
    const a = atom();
    if (s[j] === '-' && s[j + 1] !== undefined && s[j + 1] !== ']' && a[1] >= 0) {
      j++;
      const b = atom();
      if (b[1] < 0 || b[1] < a[1]) throw new Invalid('invalid range');
      items.push(`${U(a[1])}-${U(b[1])}`);
      prevWasRangeEnd = true;
    } else items.push(a[0]);
  }
  // No \n inside: grep matches within one line.
  return [neg ? `[^${items.join('')}\\n]` : `[${items.join('')}]`, j];
}

/** `{` at s[i] after an atom: an interval [min, max, next index], 'literal' for a `{` grep takes literally,
 *  or throws for a malformed interval (GNU: "Invalid content of \{\}"). */
function interval(s: string, i: number): [number, number, number] | 'literal' {
  const m = /^\{([0-9,]*)\}/.exec(s.slice(i));
  if (!m) return 'literal';
  const body = /^(\d*)(,(\d*))?$/.exec(m[1]);
  if (!body || m[1] === '') throw new Invalid('invalid interval');
  const lo = body[1] === '' ? 0 : Number(body[1]);
  const hi = body[2] === undefined ? lo : body[3] === '' ? Infinity : Number(body[3]);
  if (lo > RE_DUP_MAX || (hi !== Infinity && (hi > RE_DUP_MAX || hi < lo))) throw new Invalid('invalid interval');
  return [lo, hi, i + m[0].length];
}

/** Parse a whole ERE. */
function parse(s: string): Node {
  let i = 0;
  let groups = 0;
  let completed = new Set<number>(); // groups closed so far in this branch (a back-reference needs one)

  function alternation(depth: number): Node {
    const startCompleted = new Set(completed);
    const branches: Node[] = [];
    for (;;) {
      branches.push(concatenation(depth));
      if (s[i] === '|') { i++; completed = new Set(startCompleted); continue; }
      break;
    }
    return branches.length === 1 ? branches[0] : { k: 'alt', xs: branches };
  }

  function concatenation(depth: number): Node {
    const xs: Node[] = [];
    const quantify = (min: number, max: number): void => {
      const last = xs[xs.length - 1];
      if (last === undefined) return; // nothing to repeat: a no-op (GNU)
      if (last.k === 'assert') {
        // ^ $ with a min-0 quantifier become optional (match always); word assertions stay as they are.
        if ((last.a === 'bol' || last.a === 'eol') && min === 0) xs[xs.length - 1] = EMPTY;
        return;
      }
      xs[xs.length - 1] = { k: 'rep', x: last, min, max };
    };
    while (i < s.length) {
      const c = s[i];
      if (c === '|') break;
      if (c === ')' && depth > 0) break;
      if (c === '\\') {
        if (i + 1 >= s.length) throw new Invalid('trailing backslash');
        const e = String.fromCodePoint(s.codePointAt(i + 1)!);
        i += 1 + e.length;
        switch (e) {
          case 'w': xs.push({ k: 'set', cls: WORD }); break;
          case 'W': xs.push({ k: 'set', cls: `[^_${ALNUM}\\n]` }); break;
          case 's': xs.push({ k: 'set', cls: CLASSES.space }); break;
          case 'S': xs.push({ k: 'set', cls: `[^${SPACE_CHARS}\\n]` }); break;
          case 'b': xs.push({ k: 'assert', a: 'wordb' }); break;
          case 'B': xs.push({ k: 'assert', a: 'nwordb' }); break;
          case '<': xs.push({ k: 'assert', a: 'wstart' }); break;
          case '>': xs.push({ k: 'assert', a: 'wend' }); break;
          case '`': xs.push({ k: 'assert', a: 'bol' }); break;
          case "'": xs.push({ k: 'assert', a: 'eol' }); break;
          default:
            if (e >= '1' && e <= '9') {
              if (!completed.has(Number(e))) throw new Invalid('invalid back reference');
              throw new Invalid('back-references are not supported');
            }
            xs.push({ k: 'set', cls: lit(e) });
        }
        continue;
      }
      if (c === '[') { const [cls, next] = bracket(s, i); xs.push({ k: 'set', cls }); i = next; continue; }
      if (c === '(') {
        i++;
        const n = ++groups;
        const inner = alternation(depth + 1);
        if (s[i] !== ')') throw new Invalid('unmatched (');
        i++;
        completed.add(n);
        xs.push({ k: 'group', x: inner, n });
        continue;
      }
      if (c === ')') { xs.push({ k: 'set', cls: lit(')') }); i++; continue; } // unmatched ) at the top: literal
      if (c === '^') { xs.push({ k: 'assert', a: 'bol' }); i++; continue; }
      if (c === '$') { xs.push({ k: 'assert', a: 'eol' }); i++; continue; }
      if (c === '.') { xs.push({ k: 'set', cls: ANY_BUT_NEWLINE }); i++; continue; }
      if (c === '*') { quantify(0, Infinity); i++; continue; }
      if (c === '+') { quantify(1, Infinity); i++; continue; }
      if (c === '?') { quantify(0, 1); i++; continue; }
      if (c === '{') {
        const iv = interval(s, i);
        if (iv === 'literal') { xs.push({ k: 'set', cls: lit('{') }); i++; }
        else { quantify(iv[0], iv[1]); i = iv[2]; }
        continue;
      }
      const ch = String.fromCodePoint(s.codePointAt(i)!);
      xs.push({ k: 'set', cls: lit(ch) }); i += ch.length;
    }
    return xs.length === 0 ? EMPTY : xs.length === 1 ? xs[0] : { k: 'cat', xs };
  }

  const node = alternation(0);
  if (i < s.length) throw new Invalid('unexpected ' + s[i]);
  return node;
}

// ---------------------------------------------------------------- Thompson NFA
type State =
  | { t: 'char'; test: (ch: string) => boolean; out: number }
  | { t: 'split'; a: number; b: number }
  | { t: 'assert'; a: Assertion; out: number }
  | { t: 'eps'; out: number }
  | { t: 'match' };

class Nfa {
  states: State[] = [];
  private cache = new Map<string, (ch: string) => boolean>();
  constructor(private flags: string) {}

  add(st: State): number {
    if (this.states.length >= MAX_STATES) throw new Invalid('pattern too large');
    this.states.push(st);
    return this.states.length - 1;
  }

  pred(cls: string): (ch: string) => boolean {
    let f = this.cache.get(cls);
    if (!f) {
      const re = new RegExp(`^${cls}$`, this.flags); // one code point: no backtracking possible
      f = (ch) => re.test(ch);
      this.cache.set(cls, f);
    }
    return f;
  }

  /** Compile `n` so that it continues at state `next`; returns its entry state. */
  compile(n: Node, next: number): number {
    switch (n.k) {
      case 'empty': return next;
      case 'set': return this.add({ t: 'char', test: this.pred(n.cls), out: next });
      case 'assert': return this.add({ t: 'assert', a: n.a, out: next });
      case 'group': return this.compile(n.x, next);
      case 'cat': { let e = next; for (let k = n.xs.length - 1; k >= 0; k--) e = this.compile(n.xs[k], e); return e; }
      case 'alt': {
        let e = this.compile(n.xs[n.xs.length - 1], next);
        for (let k = n.xs.length - 2; k >= 0; k--) e = this.add({ t: 'split', a: this.compile(n.xs[k], next), b: e });
        return e;
      }
      case 'rep': {
        let e = next;
        if (n.max === Infinity) {
          // x* : a loop through a split
          const loop = this.add({ t: 'split', a: -1, b: next });
          const body = this.compile(n.x, loop);
          (this.states[loop] as { a: number }).a = body;
          e = loop;
        } else {
          e = this.optionalChain(n.x, n.max - n.min, next); // x{0,max-min}
        }
        for (let k = 0; k < n.min; k++) e = this.compile(n.x, e);
        return e;
      }
    }
  }

  /** x? x? … (count times), each may stop early and go to `next`. */
  private optionalChain(x: Node, count: number, next: number): number {
    let e = next;
    for (let k = 0; k < count; k++) e = this.add({ t: 'split', a: this.compile(x, e), b: next });
    return e;
  }
}

/** Run the NFA over one line: does any substring match? */
function nfaSearch(nfa: Nfa, start: number, line: string, isWord: (ch: string) => boolean, budget: { steps: number }): boolean {
  const chars = Array.from(line);
  const n = chars.length;
  const S = nfa.states;
  const mark = new Int32Array(S.length).fill(-1);
  let gen = 0;
  const ok = (a: Assertion, i: number): boolean => {
    const p = i > 0 && isWord(chars[i - 1]);
    const q = i < n && isWord(chars[i]);
    switch (a) {
      case 'bol': return i === 0;
      case 'eol': return i === n;
      case 'wordb': return p !== q;
      case 'nwordb': return p === q;
      case 'wstart': return !p && q;
      case 'wend': return p && !q;
    }
  };
  // closure from `s` at position i into `list` (char states and match only)
  const closure = (s: number, i: number, list: number[]): boolean => {
    const stack = [s];
    while (stack.length) {
      const x = stack.pop()!;
      if (--budget.steps < 0) throw new OverBudget();
      if (mark[x] === gen) continue;
      mark[x] = gen;
      const st = S[x];
      switch (st.t) {
        case 'match': return true;
        case 'char': list.push(x); break;
        case 'eps': stack.push(st.out); break;
        case 'split': stack.push(st.b, st.a); break;
        case 'assert': if (ok(st.a, i)) stack.push(st.out); break;
      }
    }
    return false;
  };
  let cur: number[] = [];
  for (let i = 0; ; i++) {
    gen++;
    const next: number[] = [];
    // states carried from the previous character
    for (const x of cur) if (closure(x, i, next)) return true;
    // a new attempt starts at every position (unanchored search)
    if (closure(start, i, next)) return true;
    if (i === n) return false;
    const ch = chars[i];
    cur = [];
    for (const x of next) { const st = S[x] as { t: 'char'; test: (c: string) => boolean; out: number }; if (st.test(ch)) cur.push(st.out); }
  }
}

// ---------------------------------------------------------------- API
export interface Matcher { test(text: string): boolean }

/** A matcher for the pattern, or null when grep -E would reject it or the port refuses it (the caller then
 *  stays silent).
 *  test(text) is `printf '%s' "$text" | grep -qE -- "$src"`: any line matches; empty text has no line;
 *  one trailing newline ends the last line. */
export function ere(src: string, opts: { i?: boolean } = {}): Matcher | null {
  let nfa: Nfa, start: number;
  try {
    const node = parse(src);
    nfa = new Nfa(opts.i ? 'vi' : 'v');
    start = nfa.compile(node, nfa.add({ t: 'match' }));
  } catch {
    return null;
  }
  const isWord = nfa.pred(WORD);
  return {
    test: (text) => {
      if (text === '') return false;
      const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
      const budget = { steps: MAX_STEPS + STEPS_PER_CHAR * text.length };
      try { return lines.some((l) => nfaSearch(nfa, start, l, isWord, budget)); } catch { return false; }
    },
  };
}

/** wf_match: an empty pattern never matches; otherwise ere(src).test(text), silent on an invalid pattern. */
export function ereTest(src: string, text: string, opts: { i?: boolean } = {}): boolean {
  if (src === '') return false;
  return ere(src, opts)?.test(text) ?? false;
}
