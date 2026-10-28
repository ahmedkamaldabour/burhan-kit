import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitDir } from './kit.js';

/** A template line that is data to fill in: a field (`- **Label:** …`), a table row, a line that is only `<…>`, or a heading with `<…>`. The knowledge-review line is not one: it is decided after QC, so at plan time it stays as the template gives it. */
const DATA_LINE = /^(?:- \*\*|\||<[^<>\n]+>$|#{2,3} |> As a <)/;
const PLACEHOLDER = /<[^<>\n]+>/;
/** A table row whose first cell is filled and whose other cells are all empty (`| AC-01 | | |`). */
const emptyRow = (l: string): boolean => {
  const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  return l.startsWith('|') && cells.length >= 3 && cells[0] !== '' && !/^:?-+:?$/.test(cells[0]!) && cells.slice(1).every((c) => c === '');
};

/** The lines of a template that are still, word for word, in the text: a placeholder (`<the complete test code>`) or an empty table row left as the template gave
 *  it. A line `item new` filled in (the title, the slug, the route, the mode) is no longer the template's, so it is not here. Exact, not a ban on angle brackets. */
export function placeholderLines(text: string, template: string): string[] {
  const have = new Set(text.split('\n').map((l) => l.replace(/\r$/, '').trim()));
  const out: string[] = [];
  for (const raw of template.split('\n')) {
    const l = raw.replace(/\r$/, '').trim();
    if (l === '' || !DATA_LINE.test(l) || !(PLACEHOLDER.test(l) || emptyRow(l)) || !have.has(l) || out.includes(l)) continue;
    out.push(l);
  }
  return out;
}

/** Data rows of a table with no text in any cell (a row left empty); a separator row and a header row are not. Lines in a code fence are not read. */
export function emptyTableRows(text: string): number {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '').trim());
  let fence = false;
  let n = 0;
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence || !l.startsWith('|') || !/\|$/.test(l)) return;
    const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const inTable = (lines[i - 1] ?? '').startsWith('|');
    if (inTable && cells.length >= 2 && cells.every((c) => c === '')) n++;
  });
  return n;
}

/** The template `<name>.md`: the project's own under `.burhan/templates/`, else the one this kit ships. null when neither is a plain file. */
export function projectTemplate(project: string, name: string): string | null {
  for (const path of [join(project, '.burhan', 'templates', `${name}.md`), join(kitDir(), 'templates', `${name}.md`)]) {
    try { if (existsSync(path) && lstatSync(path).isFile()) return readFileSync(path, 'utf8'); } catch { /* try the next */ }
  }
  return null;
}

/** `placeholder-left` text for a file, or null when it has none. */
export function placeholderReport(project: string, text: string, template: 'story' | 'plan' | 'build-spec' | 'findings'): string | null {
  const t = projectTemplate(project, template);
  const left = t === null ? [] : placeholderLines(text, t);
  const empty = emptyTableRows(text);
  if (left.length === 0 && empty === 0) return null;
  const shown = left.slice(0, 3).map((l) => (l.length > 90 ? `${l.slice(0, 90)}…` : l)).join(' · ');
  const parts = [left.length > 0 ? `${left.length} template placeholder${left.length === 1 ? '' : 's'} left: ${shown}${left.length > 3 ? ` · and ${left.length - 3} more` : ''}` : '', empty > 0 ? `${empty} empty table row${empty === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `${parts.join('; ')} in the ${template === 'build-spec' ? 'build spec' : template}`;
}
