/** Which commands of a command line can be verification evidence: the evidence pattern is tested on the commands the line runs, never on
 *  words that only appear in it (`echo "npm test"`, `grep "npm test" f`, a comment, a heredoc body). Pure string reading: nothing is
 *  executed or expanded, and any failure falls back to the old whole-text test. */

export interface Tester { test(text: string): boolean }

/** Commands that print or search text: what follows is a mention, not a run. */
const MENTION_ONLY = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'man', 'which', 'type', 'wc', 'diff', 'read']);
const PREFIX_WORDS = new Set(['sudo', 'env', 'time', 'nohup', 'nice', 'command', 'exec', 'then', 'do', 'else', 'elif', '{', '!']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

interface Word { text: string; raw: string | null }   // text: quoted parts masked as Q; raw: the content when the word is one quoted string

const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1);
const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(word);

/** The simple commands of a command line, as word lists: split on newline, `;`, `&&`, `||`, `|`, `&` and `(` `)` `` ` `` outside quotes;
 *  quoted text masked; `#` comments and heredoc bodies dropped. */
function pieces(cmd: string): Word[][] {
  const out: Word[][] = [];
  let words: Word[] = [];
  let text = '';
  let raw: string | null = null;     // content of a quote that is the whole word so far
  let started = false;               // a word has begun
  let quote = '';
  let quoted = '';
  let skipHeredoc: string[] = [];    // delimiters waiting for the next newline
  const endWord = (): void => { if (started) words.push({ text, raw }); text = ''; raw = null; started = false; };
  const endPiece = (): void => { endWord(); if (words.length > 0) out.push(words); words = []; };
  const n = cmd.length;
  for (let i = 0; i < n; i++) {
    const c = cmd[i]!;
    if (quote !== '') {
      if (c === quote) { quote = ''; text += 'Q'; raw = !started || text === 'Q' ? quoted : null; started = true; quoted = ''; continue; }
      if (c === '\\' && quote === '"' && i + 1 < n) { quoted += cmd[++i]!; continue; }
      quoted += c;
      continue;
    }
    if (c === '\\' && (cmd[i + 1] === '\n' || (cmd[i + 1] === '\r' && cmd[i + 2] === '\n'))) { i += cmd[i + 1] === '\r' ? 2 : 1; continue; }   // a line continuation joins the lines
    if (c === '\\' && i + 1 < n) { text += cmd[++i]!; started = true; raw = null; continue; }
    if (c === '"' || c === "'") { quote = c; quoted = ''; if (started && text !== '') raw = null; continue; }
    if (c === '\n') {
      endPiece();
      for (const delimiter of skipHeredoc) {
        let j = i + 1;
        for (;;) {
          const end = cmd.indexOf('\n', j);
          const line = cmd.slice(j, end < 0 ? n : end).replace(/\r$/u, '');
          j = end < 0 ? n : end + 1;
          if (line.trim() === delimiter || end < 0) break;
        }
        i = j - 1;
      }
      skipHeredoc = [];
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); continue; }
    if (c === '#' && !started) { while (i + 1 < n && cmd[i + 1] !== '\n') i++; continue; }
    if (c === ';' || c === '|' || c === '(' || c === ')' || c === '`') { endPiece(); continue; }
    if (c === '&') {
      const prev = cmd[i - 1], next = cmd[i + 1];
      if (prev === '>' || prev === '<' || next === '>') { text += c; started = true; raw = null; continue; }   // 2>&1, &>file
      endPiece();
      continue;
    }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      const word = /^<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_.-]*)\1/u.exec(cmd.slice(i));
      if (word) { skipHeredoc.push(word[2]!); text += word[0]; started = true; raw = null; i += word[0].length - 1; continue; }
    }
    text += c; started = true; raw = null;
  }
  if (quote !== '') throw new Error('unbalanced quote');
  endPiece();
  return out;
}

/** The commands of the line that can be evidence, each as text with quoted parts masked as `Q`. A shell `-c` string is read as a line of its own. */
export function commandsOf(cmd: string): string[] {
  const result: string[] = [];
  for (const words of pieces(cmd)) {
    let i = 0;
    while (i < words.length && (isAssignment(words[i]!.text) || PREFIX_WORDS.has(words[i]!.text))) {
      const prefix = PREFIX_WORDS.has(words[i]!.text);
      i++;
      while (prefix && i < words.length && words[i]!.text.startsWith('-')) i++;
    }
    const first = i < words.length ? baseName(words[i]!.text) : '';
    if (first === '' || MENTION_ONLY.has(first)) continue;
    if (SHELLS.has(first)) {
      let flag = -1;   // `-c` counts only among the shell's own options, before its first operand (`bash tests/a.sh -c conf` is a script run)
      for (let at = i + 1; at < words.length && words[at]!.text.startsWith('-'); at++) if (/^-[A-Za-z]*c[A-Za-z]*$/u.test(words[at]!.text)) { flag = at; break; }
      const next = flag < 0 ? undefined : words[flag + 1];
      if (next) { result.push(...commandsOf(next.raw ?? next.text)); continue; }
    }
    result.push(words.map((word) => word.text).join(' '));
  }
  return result;
}

/** True when the evidence pattern matches a command the line runs. A line that cannot be read is tested whole, as before. */
export function evidenceMatches(pattern: Tester, cmd: string): boolean {
  let parts: string[];
  try { parts = commandsOf(cmd); } catch { return pattern.test(cmd); }
  return parts.some((part) => pattern.test(part));
}
