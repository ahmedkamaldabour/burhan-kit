import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviations, fenced } from '../src/hooks/core/item-model.mjs';
import { placeholderLines } from '../src/lib/placeholders.js';
import { cli, itemDir, planFile, project, projectWithItem, read, specFile, storyFile, write } from './item-fixture.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** The line numbers (from 1) of the table headers that sit right under a line that is not blank and not a table row: a prose line, a heading,
 *  a list item or a fence. A header is a line that starts with `|` and is followed by a delimiter row (`|---|---|`). Lines in a code fence are not
 *  read; a CR at the end of a line does not count. */
function gluedTables(text: string): number[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const inFence = fenced(lines);
  const out: number[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    if (inFence[i] || inFence[i + 1]) continue;
    const above = lines[i - 1]!.trim();
    const next = lines[i + 1]!.trim();
    if (!lines[i]!.trim().startsWith('|') || !next.includes('|') || !DELIMITER.test(next)) continue;
    if (above === '' || above.startsWith('|')) continue;
    out.push(i + 1);
  }
  return out;
}

/** Every `.md` file under a folder of the repository, as a path with `/`. */
function markdownFiles(folder: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) visit(path);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(relative(ROOT, path).split(sep).join('/'));
    }
  };
  visit(join(ROOT, folder));
  return out.sort();
}

/** `file:line` for every glued table of the given texts. */
const glued = (files: Array<[string, string]>): string[] => files.flatMap(([name, text]) => gluedTables(text).map((n) => `${name}:${n}`));
const folderFiles = (dir: string): Array<[string, string]> => readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => [n, read(join(dir, n))]);

test('the check names a table under prose or a heading, and reads a blank line, the top of a file, a code fence and CRLF the same way', () => {
  assert.deepEqual(gluedTables('intro\n| a | b |\n|---|---|\n| 1 | 2 |\n'), [2]);
  assert.deepEqual(gluedTables('## Heading\n| a |\n|---|\n'), [2]);
  assert.deepEqual(gluedTables('- a list item\n| a |\n| :-: |\n'), [2]);
  assert.deepEqual(gluedTables('intro\n\n| a | b |\n|---|---|\n'), []);
  assert.deepEqual(gluedTables('| a | b |\n|---|---|\n'), []);
  assert.deepEqual(gluedTables('```\nintro\n| a |\n|---|\n```\n'), []);
  assert.deepEqual(gluedTables('````\nintro\n| a |\n|---|\n````\n'), []);
  assert.deepEqual(gluedTables('intro\n| a | b |\n| c | d |\n'), [], 'no delimiter row: not a table');
  assert.deepEqual(gluedTables('intro\n---\n'), [], 'a rule is not a table');
  assert.deepEqual(gluedTables('intro\r\n| a |\r\n|---|\r\n'), [2]);
  assert.deepEqual(gluedTables('intro\r\n\r\n| a |\r\n|---|\r\n'), []);
});

test('no table in the kit or the docs sits right under a line of text: a blank line comes first', () => {
  const files = [...markdownFiles('kit'), ...markdownFiles('docs')];
  assert.ok(files.includes('kit/templates/plan.md') && files.includes('kit/phases/stage-plan.md') && files.includes('docs/configuration.md'), files.join(' '));
  assert.deepEqual(glued(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')])), []);
});

test('item new makes files with no glued table, for every route that has files, from LF and from CRLF templates', async () => {
  const routes = [['feature', 'bounded'], ['feature', 'architectural'], ['bug', 'spike'], ['bug', 'bounded'], ['investigation', 'bounded'], ['change', 'bounded'], ['refactor', 'bounded'], ['release', 'architectural']];
  for (const crlf of [false, true]) {
    const dir = project();
    if (crlf) for (const name of ['story.md', 'plan.md', 'build-spec.md', 'findings.md']) {
      const p = join(dir, '.burhan', 'templates', name);
      writeFileSync(p, read(p).replace(/\n/g, '\r\n'));
    }
    for (const [type, scope] of routes) {
      const slug = `${type}-${scope}`;
      const r = await cli(dir, ['item', 'new', slug, '--type', type!, '--scope', scope!]);
      assert.equal(r.code, 0, r.err);
      const files = folderFiles(itemDir(dir, slug));
      assert.ok(files.length > 0, slug);
      assert.deepEqual(glued(files), [], `${slug}${crlf ? ' (CRLF)' : ''}`);
    }
  }
});

test('item check, approve story, approve plan and gate tick read files that have a blank line above every table', async () => {
  const dir = await projectWithItem();
  for (const args of [['item', 'check', 'foo'], ['approve', 'story', 'foo', '--by', 'dev-dabour'], ['approve', 'plan', 'foo', '--by', 'dev-dabour'], ['item', 'check', 'foo'], ['gate', 'tick', 'foo', 'Route stated']]) {
    const r = await cli(dir, args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.out}${r.err}`);
  }
  assert.match(read(planFile(dir)), /^- \*\*Overall status:\*\* Approved/m);
  assert.deepEqual(glued([['story', read(storyFile(dir))], ['plan', read(planFile(dir))], ['spec', read(specFile(dir))]]), []);
});

test('deviation add puts its row in the Deviations table and keeps the blank line above it', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  const r = await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'RED passed', '--where', 'src/a.ts:10', '--output', 'pass 1']);
  assert.equal(r.code, 0, r.err);
  const plan = read(planFile(dir));
  assert.deepEqual(deviations(plan).map((d) => [d.n, d.unit, d.status]), [[1, 1, 'open']]);
  assert.deepEqual(gluedTables(plan), []);
  const lines = plan.split('\n');
  const header = lines.findIndex((l) => l.startsWith('| # | Sub-unit |'));
  assert.deepEqual([lines[header - 1], lines[header + 2]?.startsWith('| 1 | 1 | RED passed |')], ['', true]);
});

test('unfilled-template detection finds the same lines with or without the blank line above a table, on either side', async () => {
  const dir = await projectWithItem({ raw: true });
  const glue = (t: string): string => t.replace(/\n\n(?=\|)/g, '\n'); // the old shape: every table right under the line above
  for (const [file, name] of [[storyFile(dir), 'story.md'], [planFile(dir), 'plan.md'], [specFile(dir), 'build-spec.md']] as const) {
    const text = read(file);
    const template = read(join(dir, '.burhan', 'templates', name));
    const found = placeholderLines(text, template);
    assert.ok(found.length > 0, name);
    assert.deepEqual(placeholderLines(glue(text), template), found, `${name}: an item file made before the change`);
    assert.deepEqual(placeholderLines(text, glue(template)), found, `${name}: a project template from before the change`);
  }
  const r = await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  assert.equal(r.code, 2);
  assert.match(r.err, /placeholder/);
});

test('review add writes a review, a QC report and a verification report with no glued table', async () => {
  const dir = await projectWithItem();
  const by = 'claude · opus · fresh subagent';
  for (const args of [['--kind', 'review', '--unit', '1'], ['--kind', 'qc', '--verdict', 'PASS'], ['--kind', 'verification']]) {
    const r = await cli(dir, ['review', 'add', 'foo', ...args, '--by', by, '--text', 'checked: ok']);
    assert.equal(r.code, 0, r.err);
  }
  const files = folderFiles(join(itemDir(dir), 'reviews'));
  assert.equal(files.length, 3);
  assert.deepEqual(glued(files), []);
});

test('pr-body puts a blank line between the Acceptance criteria heading and its table', async () => {
  const dir = project();
  write(storyFile(dir), '# Orders\n- **Route:** feature / bounded\n- **Status:** Approved\n\n## Acceptance criteria\n\n| ID | Criterion | Provenance |\n|----|-----------|------------|\n| AC-01 | A user sees only their orders | request |\n');
  const r = await cli(dir, ['pr-body', dir, '--item', 'foo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^## Acceptance criteria\n\n\| AC \| Criterion \| Outcome \|$/m);
  assert.deepEqual(gluedTables(r.out), []);
});
