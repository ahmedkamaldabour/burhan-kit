/** Explicit item-link parsing (ports the command-position awk in turn-audit.sh). */

const boundary = new Set(['&&', '||', ';', '|', '(']);
const assignment = /^[A-Za-z_][A-Za-z0-9_]*=[^\s;|&()]*$/;
const slug = /^[A-Za-z0-9._-]+$/;

/** Remove quoted text exactly as the awk helper does; an unclosed quote invalidates the whole command. */
function unquoted(input: string): string {
  let quote = '';
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote !== '') {
      if (ch === '\\' && quote === '"') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ' '; }
    else out += ch;
  }
  return quote === '' ? out : '';
}

function tokens(line: string): string[] {
  const or = '__WF_OR__';
  return line.replace(/&&/g, ' && ').replace(/\|\|/g, ` ${or} `).replace(/;/g, ' ; ')
    .replace(/\|/g, ' | ').replace(/\(/g, ' ( ').replaceAll(or, '||').trim().split(/\s+/).filter(Boolean);
}

/** Last qualifying use command in the stream, or empty. */
export function explicitLink(cmds: string[]): string {
  let found = '';
  try {
    for (const cmdline of cmds) {
      const line = unquoted(cmdline);
      if (line === '') continue;
      const a = tokens(line);
      for (let i = 0; i < a.length; i++) {
        if (i !== 0 && !boundary.has(a[i - 1]!)) continue;
        let j = i;
        while (assignment.test(a[j] ?? '')) j++;
        let candidate = '';
        let end = j;
        if ((a[j] === 'burhan' || a[j] === 'burhan-kit') && a[j + 1] === 'use') { candidate = a[j + 2] ?? ''; end = j + 2; }
        else if (a[j] === 'npx' && a[j + 1] === 'burhan-kit' && a[j + 2] === 'use') { candidate = a[j + 3] ?? ''; end = j + 3; }
        else if (a[j] === 'node' && /\/cli\.js$/.test(a[j + 1] ?? '') && a[j + 2] === 'use') { candidate = a[j + 3] ?? ''; end = j + 3; }
        if (slug.test(candidate) && (end === a.length - 1 || boundary.has(a[end + 1]!))) found = candidate;
      }
    }
  } catch { return found; }
  return found;
}
