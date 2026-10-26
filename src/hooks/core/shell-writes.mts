/** Files a command writes via shell redirection or `tee` — a direct port of shell-writes.awk.
 *  This is intentionally a heuristic rather than a shell tokenizer: its edge cases are part of the contract. */

const Q = '\x01'; // a space inside quotes
const G = '\x02'; // a `>` inside quotes

// awk's global set by token_at.
let TOKEN_END = 0;

/** Index of the first `<<` on a line that is outside quotes and is not a here-string `<<<`, or -1. */
function heredocAt(line: string): number {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q !== '') { if (c === '\\' && q === '"') i++; else if (c === q) q = ''; continue; }
    if (c === '\\') { i++; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '<' && line[i + 1] === '<') {
      if (line[i + 2] === '<') { i += 2; continue; }
      return i;
    }
  }
  return -1;
}

/** awk: drop_heredocs */
function drop_heredocs(s: string): string {
  const line = s.split('\n');
  let out = '';
  let delim = '';
  let strip = false;

  for (let i = 0; i < line.length; i++) {
    if (delim !== '') {
      let c = line[i];
      if (strip) c = c.replace(/^\t+/, '');
      if (c === delim) delim = '';
      continue;
    }

    out = out === '' ? line[i] : out + '\n' + line[i];
    const h = heredocAt(line[i]);
    if (h >= 0) {
      let rest = line[i].slice(h + 2);
      strip = false;
      if (rest[0] === '-') { strip = true; rest = rest.slice(1); }
      // The delimiter word runs to whitespace or an operator; its quotes and backslashes are not part of it. A shift (`1<<3`) is no heredoc.
      const word = /^[^\s;|&<>()]*/.exec(rest.replace(/^[ \t]*/, ''))?.[0].replace(/["'\\]/g, '') ?? '';
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(word)) delim = word;
    }
  }
  return out;
}

/** awk: neutralise */
function neutralise(s: string): string {
  let out = '';
  let q = '';
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (q === '') {
      if (c === '\\') {
        i++;
        c = s[i] ?? '';
        if (c === ' ' || c === '\t') c = Q;
        else if (c === '>') c = G;
        out += c;
        continue;
      }
      if (c === "'" || c === '"') { q = c; continue; }
      out += c;
    } else {
      if (c === q) { q = ''; continue; }
      if (q === '"' && c === '\\') { i++; c = s[i] ?? ''; }
      if (c === ' ' || c === '\t') c = Q;
      else if (c === '>') c = G;
      out += c;
    }
  }
  return out;
}

/** awk: drop_brackets */
function drop_brackets(s: string): string {
  let a: number;
  let b: number;
  while ((a = s.indexOf('[[')) >= 0 && (b = s.indexOf(']]', a)) >= 0) {
    s = s.slice(0, a) + ' ' + s.slice(b + 2);
  }
  return s;
}

/** awk: restore */
function restore(t: string): string {
  return t.split(Q).join(' ').split(G).join('>');
}

/** awk: emit */
function emit(t: string, writes: string[]): void {
  t = restore(t).replace(/\r+$/, '');
  if (t === '' || t.startsWith('/dev/') || /^[0-9]+$/.test(t) || t.startsWith('&')) return;
  writes.push(t);
}

/** awk: token_at */
function token_at(s: string, j: number): string {
  while (s[j] === ' ' || s[j] === '\t') j++;
  let k = j;
  while (k < s.length) {
    const c = s[k];
    if (c === ' ' || c === '\t' || c === '\n' || c === '`' || ';|&<>()'.includes(c)) break;
    k++;
  }
  TOKEN_END = k;
  return s.slice(j, k);
}

/** The shell-writes.awk record action, once per command string. Never throws: return collected writes on failure. */
export function shellWrites(cmds: string[]): string[] {
  const writes: string[] = [];
  try {
    for (const cmd of cmds) {
      let s = drop_heredocs(cmd);
      s = drop_brackets(neutralise(s));

      // --- redirections
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== '>') continue;
        const p = s[i - 1] ?? '';
        if (p === '>') continue;                                  // second char of >>
        if (p === '-' || p === '=' || p === '<') continue;       // -> => <>
        if (/[0-9]/.test(p)) {                                    // fd prefix: only 1> is stdout
          let k = i - 1;
          while (k > 0 && /[0-9]/.test(s[k - 1])) k--;
          if (s.slice(k, i) !== '1') continue;
          if (k > 0 && !' \t;|&(\n'.includes(s[k - 1])) continue; // part of a word, e.g. $((3>2))
        }
        let j = i + 1;
        if (s[j] === '>') j++;
        if (s[j] === '|') j++;
        if (s[j] === '&') {                                      // >&2, >&- and >&$fd duplicate a descriptor; >& file writes both streams
          const word = token_at(s, j + 1);
          if (/^([0-9]*-?|\$.*)$/.test(word)) continue;                // a descriptor number, `-`, or a variable holding one
        }
        emit(token_at(s, s[j] === '&' ? j + 1 : j), writes);
        i = TOKEN_END - 1;
      }

      // --- tee [opts] file…
      const w = s.split(/[ \t\n]+/);
      for (let i = 0; i < w.length; i++) {
        if (w[i] !== 'tee') continue;
        for (let k = i + 1; k < w.length; k++) {
          if (/[;|&<>()]/.test(w[k])) break;
          if (w[k].startsWith('-')) continue;
          emit(w[k], writes);
        }
      }
    }
  } catch {
    return writes;
  }
  return writes;
}
