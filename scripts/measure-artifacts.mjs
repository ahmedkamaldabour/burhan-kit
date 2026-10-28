// Counts what a session reads: words, bytes and an ESTIMATED token count (bytes / 4: no tokenizer is installed or allowed as a dependency).
//   node scripts/measure-artifacts.mjs [--root <dir>] [--file <path>]... [--set <label>=<path>,<path>]... [--sections <path>]
// With no --file and no --set it measures the session-start files, e2e.md, lifecycle.md and the plan template.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_FILES = ['CLAUDE.md', 'kit/WORKFLOW.md', '.burhan/bindings.md', '.burhan/local/PROGRESS.md', 'kit/commands/e2e.md', 'kit/phases/lifecycle.md', 'kit/templates/plan.md'];

/** A word is a run of non-space characters: one pass, no backtracking. */
export const countText = (text) => ({
  words: text.split(/\s+/).filter((w) => w !== '').length,
  bytes: Buffer.byteLength(text, 'utf8'),
});
const estimate = (bytes) => Math.ceil(bytes / 4);

const argv = process.argv.slice(2);
const all = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const root = all('--root')[0] ?? '.';
const files = all('--file');
const sets = all('--set');
const sections = all('--sections');

let failed = false;
const read = (rel) => {
  const p = join(root, rel);
  if (!existsSync(p)) { console.error(`${rel}: missing`); failed = true; return null; }
  return readFileSync(p, 'utf8');
};
const row = (label, c) => `| ${label} | ${c.words} | ${c.bytes} | ${estimate(c.bytes)} |`;
const head = ['| File | Words | Bytes | Tokens (estimate: bytes / 4) |', '|------|-------|-------|------------------|'];

if (sections.length > 0) {
  for (const rel of sections) {
    const text = read(rel);
    if (text === null) continue;
    const out = ['| Section | Words | Words in table rows |', '|---------|-------|---------------------|'];
    let title = '(before the first "## ")';
    let words = 0;
    let inTable = 0;
    const flush = () => { if (words > 0) out.push(`| ${title} | ${words} | ${inTable} |`); };
    for (const line of text.split('\n')) {
      if (/^## /.test(line)) { flush(); title = line.slice(3).trim(); words = 0; inTable = 0; continue; }
      const n = countText(line).words;
      words += n;
      if (line.trim().startsWith('|')) inTable += n;
    }
    flush();
    console.log(`${rel}\n${out.join('\n')}`);
  }
} else {
  const wanted = files.length === 0 && sets.length === 0 ? DEFAULT_FILES : files;
  const rows = [];
  for (const rel of wanted) { const t = read(rel); if (t !== null) rows.push(row(rel, countText(t))); }
  for (const s of sets) {
    const eq = s.indexOf('=');
    const parts = eq < 0 ? [] : s.slice(eq + 1).split(',').filter((p) => p !== '');
    let sum = { words: 0, bytes: 0 };
    let ok = parts.length > 0;
    for (const rel of parts) { const t = read(rel); if (t === null) ok = false; else { const c = countText(t); sum = { words: sum.words + c.words, bytes: sum.bytes + c.bytes }; } }
    if (ok) rows.push(row(`${s.slice(0, eq)} (sum of ${parts.length} files)`, sum));
    else failed = true;
  }
  console.log([...head, ...rows].join('\n'));
}
process.exit(failed ? 1 : 0);
