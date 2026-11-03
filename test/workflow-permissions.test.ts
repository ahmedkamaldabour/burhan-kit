import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const folder = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

type Rights = Record<string, string>;
type Permissions = { top: Rights; jobs: Record<string, Rights> };

/** The token rights each workflow may have: nothing at the top, and what each job needs (docs/releasing.md · Token rights). */
const EXPECTED: Record<string, Permissions> = {
  'ci.yml': {
    top: {},
    jobs: { test: { contents: 'read' }, windows: { contents: 'read' } },
  },
  'release.yml': {
    top: {},
    jobs: {
      guard: { contents: 'read' },
      verify: { contents: 'read' },
      pack: { contents: 'read' },
      publish: { contents: 'read', 'id-token': 'write' },
      'github-release': { contents: 'write' },
    },
  },
};

/**
 * Reads the top-level and per-job `permissions` of a workflow, as text (no YAML parser). It accepts only two forms:
 * `permissions: {}`, or `permissions:` followed by `<name>: read|write|none` lines two spaces deeper. Anything else
 * throws: read-all or write-all anywhere, another flow form, a quoted or commented line in a block, a job without its
 * own block, a duplicate, a `permissions:` key at any other depth, a line at a job's depth that is not a job name alone,
 * the key in any other spelling YAML reads as `permissions` (quoted, after a tag or an anchor, a space before the colon),
 * or a key whose name it cannot tell (an escape in a double-quoted key, an explicit `?` key, an alias, a `<<` merge key).
 */
function permissionsOf(text: string): Permissions {
  const lines = text.split(/\r?\n/);
  const bad = lines.find((l) => /\b(read|write)-all\b/.test(l));
  if (bad !== undefined) throw new Error(`read-all or write-all: ${bad.trim()}`);

  const block = (at: number, indent: string): Rights => {
    const rest = lines[at]!.slice(`${indent}permissions:`.length).trim();
    if (rest === '{}') return {};
    if (rest !== '') throw new Error(`a permissions form other than {} or a block: ${lines[at]!.trim()}`);
    const rights: Rights = {};
    for (let i = at + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === '') continue;
      if (line.length - line.trimStart().length <= indent.length) break;
      const m = new RegExp(`^${indent}  ([a-z-]+): (read|write|none)$`).exec(line);
      if (!m) throw new Error(`a permissions line that is not "<name>: read|write|none": ${line.trim()}`);
      if (m[1]! in rights) throw new Error(`${m[1]} is given twice`);
      rights[m[1]!] = m[2]!;
    }
    return rights;
  };

  // A key whose name the reader cannot tell could be `permissions`: an escape in a double-quoted key, an explicit key
  // (`? …`), an alias as a key (`*a : …`), a merge key (`<<: *a`). None is read, so each throws.
  const unnamed = lines.find((l) => /^\s*(?:[!&]\S*\s+)*"(?:[^"\\]|\\.)*\\.(?:[^"\\]|\\.)*"\s*:|^\s*\?(?:\s|$)|^\s*\*\S+\s*:|^\s*<<\s*:/.test(l));
  if (unnamed !== undefined) throw new Error(`a key whose name this reader cannot tell: ${unnamed.trim()}`);
  // Every spelling YAML reads as the key `permissions` is that key: plain or in quotes, after a tag or an anchor, with a
  // space before the colon. Only the plain `permissions:` is read, so any other spelling throws, a second key included.
  const keys = lines.flatMap((l, i) => (/^\s*(?:[!&]\S*\s+)*(["']?)permissions\1\s*:/.test(l) ? [i] : []));
  const spelled = keys.find((i) => !/^\s*permissions:/.test(lines[i]!));
  if (spelled !== undefined) throw new Error(`a permissions key spelled other than "permissions:": ${lines[spelled]!.trim()}`);
  const top = keys.filter((i) => lines[i]!.startsWith('permissions:'));
  if (top.length !== 1) throw new Error(`the workflow needs one top-level permissions, found ${top.length}`);

  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt === -1) throw new Error('no jobs: section');
  // The next top-level key ends the jobs: section; a comment at the start of a line does not.
  const jobsEnd = lines.findIndex((l, i) => i > jobsAt && /^[^\s#]/.test(l));
  const inJobs = (i: number): boolean => i > jobsAt && (jobsEnd === -1 || i < jobsEnd);
  // A line two spaces deep in jobs: is a job name alone (a comment may follow it), a comment, or blank. Anything else, such as a whole
  // job on one line (`  evil: {runs-on: …, permissions: {contents: write}}`), is a job this reader would not see, so it throws.
  const jobHead = /^ {2}([A-Za-z0-9_-]+):(?:\s*|\s+#.*)$/;
  const odd = lines.findIndex((l, i) => inJobs(i) && /^ {2}(?! )/.test(l) && l.trim() !== '' && !l.trim().startsWith('#') && !jobHead.test(l));
  if (odd !== -1) throw new Error(`a line at a job's depth that is not a job name alone: ${lines[odd]!.trim()}`);
  const heads = lines.flatMap((l, i) => (inJobs(i) && jobHead.test(l) ? [i] : []));
  const jobs: Record<string, Rights> = {};
  const read = new Set(top);
  heads.forEach((head, n) => {
    const name = jobHead.exec(lines[head]!)![1]!;
    const end = heads[n + 1] ?? (jobsEnd === -1 ? lines.length : jobsEnd);
    const own = keys.filter((i) => i > head && i < end && lines[i]!.startsWith('    permissions:'));
    if (own.length !== 1) throw new Error(`job ${name} has ${own.length === 0 ? 'no permissions block' : 'more than one permissions block'}`);
    jobs[name] = block(own[0]!, '    ');
    read.add(own[0]!);
  });
  const stray = keys.find((i) => !read.has(i));
  if (stray !== undefined) throw new Error(`permissions at a place this reader does not check: line ${stray + 1}`);
  return { top: block(top[0]!, ''), jobs };
}

const files = readdirSync(folder).filter((name) => /\.ya?ml$/.test(name)).sort();

test('every workflow file has a row in the expected table, and every row has a file', () => {
  assert.deepEqual(files, Object.keys(EXPECTED).sort());
});

test('each workflow grants nothing at the top, and each job exactly the rights of the table', () => {
  for (const name of files) assert.deepEqual(permissionsOf(readFileSync(join(folder, name), 'utf8')), EXPECTED[name], name);
});

const job = ['  a:', '    runs-on: ubuntu-24.04'];
const steps = ['    steps:', '      - run: echo', ''];
const workflow = (top: string[], ...jobLines: string[][]): string =>
  ['name: x', 'on: push', ...top, 'jobs:', ...jobLines.flat()].join('\n');
const fine = workflow(['permissions: {}'], [...job, '    permissions:', '      contents: read', ...steps]);

test('the reader reads a well-formed workflow', () => {
  assert.deepEqual(permissionsOf(fine), { top: {}, jobs: { a: { contents: 'read' } } });
});

test('the reader refuses a job without its own permissions block', () => {
  assert.throws(() => permissionsOf(workflow(['permissions: {}'], [...job, ...steps])), /job a has no permissions block/);
});

test('the reader refuses read-all and write-all, at the top or in a job', () => {
  assert.throws(() => permissionsOf(workflow(['permissions: write-all'], [...job, '    permissions: {}', ...steps])), /read-all or write-all/);
  assert.throws(() => permissionsOf(workflow(['permissions: {}'], [...job, '    permissions: read-all', ...steps])), /read-all or write-all/);
});

test('the reader refuses a flow form other than {}, and a quoted or commented block line', () => {
  assert.throws(() => permissionsOf(workflow(['permissions: { contents: write }'], [...job, '    permissions: {}', ...steps])), /other than \{\}/);
  assert.throws(() => permissionsOf(workflow(['permissions: {}'], [...job, '    permissions:', "      contents: 'write'", ...steps])), /not "<name>: read\|write\|none"/);
  assert.throws(() => permissionsOf(workflow(['permissions: {}'], [...job, '    permissions:', '      # contents: read', ...steps])), /not "<name>: read\|write\|none"/);
});

test('the reader refuses a missing top-level permissions, and one at a depth it does not check', () => {
  assert.throws(() => permissionsOf(workflow([], [...job, '    permissions: {}', ...steps])), /one top-level permissions, found 0/);
  assert.throws(() => permissionsOf(workflow(['permissions: {}'], [...job, '    permissions: {}', '    steps:', '      - run: echo', '        permissions: {}'])), /a place this reader does not check/);
});

test('a right after a blank line in a block is still read, and a job or a right the table lacks fails the comparison', () => {
  const extra = workflow(['permissions: {}'], [...job, '    permissions:', '      contents: read', '', '      issues: write', ...steps], ['  b:', '    permissions: {}', ...steps]);
  const read = permissionsOf(extra);
  assert.deepEqual(read, { top: {}, jobs: { a: { contents: 'read', issues: 'write' }, b: {} } });
  assert.notDeepEqual(read, { top: {}, jobs: { a: { contents: 'read' } } });
});

/** A whole job on one line, as a flow mapping, holding write rights: GitHub runs it, so the reader must never pass over it. */
const evil = '  evil: {runs-on: ubuntu-24.04, permissions: {contents: write, id-token: write}, steps: [{run: echo}]}';

test('the reader refuses a job written on one line as a flow mapping, also after a comment at the start of a line', () => {
  const ci = readFileSync(join(folder, 'ci.yml'), 'utf8');
  for (const text of [`${fine}${evil}\n`, `${ci}${evil}\n`, `${fine}# a comment at the start of a line\n${evil}\n`]) {
    assert.throws(() => permissionsOf(text), /a line at a job's depth that is not a job name alone: evil: \{runs-on/);
  }
});

test('a job head with a comment after its name is still a job, so without its own block it is refused', () => {
  const text = workflow(['permissions: {}'], [...job, '    permissions: {}', ...steps], ['  b: # no rights given', ...steps]);
  assert.throws(() => permissionsOf(text), /job b has no permissions block/);
});

/** The QC's probes A and B: a second permissions key in quotes after the real one. YAML reads it as the same key. */
test('the reader refuses a second permissions key written in quotes, at the top or in a job', () => {
  const ci = readFileSync(join(folder, 'ci.yml'), 'utf8');
  const atTop = ci.replace('permissions: {}\n', 'permissions: {}\n"permissions": {contents: write}\n');
  const inJob = ci.replace('    permissions:\n      contents: read\n', "    permissions:\n      contents: read\n    'permissions': {contents: write}\n");
  for (const text of [atTop, inJob]) {
    assert.notEqual(text, ci);
    assert.throws(() => permissionsOf(text), /a permissions key spelled other than "permissions:"/);
  }
});

test('the reader refuses a second plain permissions key, at the top or in a job', () => {
  assert.throws(() => permissionsOf(workflow(['permissions: {}', 'permissions: {}'], [...job, '    permissions: {}', ...steps])), /one top-level permissions, found 2/);
  assert.throws(() => permissionsOf(workflow(['permissions: {}'], [...job, '    permissions: {}', ...steps, '    permissions:', '      contents: write'])), /job a has more than one permissions block/);
});

test('the reader refuses every other spelling YAML reads as the permissions key: a tag, an anchor, a space before the colon', () => {
  for (const key of ['!!str permissions:', '&p permissions:', 'permissions :', '"permissions" :']) {
    const top = workflow(['permissions: {}', `${key} {contents: write}`], [...job, '    permissions: {}', ...steps]);
    const inJob = workflow(['permissions: {}'], [...job, '    permissions: {}', `    ${key} {contents: write}`, ...steps]);
    for (const text of [top, inJob]) assert.throws(() => permissionsOf(text), /a permissions key spelled other than "permissions:"/, key);
  }
});

test('the reader refuses a key whose name it cannot tell: an escape in quotes, an explicit ? key, an alias, a merge key', () => {
  for (const extra of [['"permi\\x73sions": {contents: write}'], ['? permissions', ': {contents: write}'], ['*p : {contents: write}'], ['<<: *p']]) {
    const top = workflow(['permissions: {}', ...extra], [...job, '    permissions: {}', ...steps]);
    const inJob = workflow(['permissions: {}'], [...job, '    permissions: {}', ...extra.map((l) => `    ${l}`), ...steps]);
    for (const text of [top, inJob]) assert.throws(() => permissionsOf(text), /a key whose name this reader cannot tell/, extra[0]);
  }
});
