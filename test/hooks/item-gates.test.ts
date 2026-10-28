import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { cli, itemDir, planFile, project, projectWithItem, read, storyFile, write } from '../item-fixture.js';
import { tmpDir } from '../helpers.js';

const D = '.burhan/work';
const SESSION = 'S1';

/** A project that has item `foo` (made by `burhan item new`) and the hook config; the turn is run through the real turn-audit hook. */
async function setup(o: { type?: string; scope?: string; block?: string; contract?: boolean } = {}): Promise<{ dir: string; store: string }> {
  const dir = o.type === undefined ? await projectWithItem() : project();
  if (o.type !== undefined) await cli(dir, ['item', 'new', 'foo', '--type', o.type, '--scope', o.scope ?? 'bounded']);
  const store = tmpDir('burhan-gates-store-');
  writeFileSync(join(dir, '.burhan/workflow.config'), [`WF_DOCS_DIR=${D}`, 'WF_STATE_FILE=.burhan/local/PROGRESS.md', `WF_EVIDENCE_DIR='${store}'`, "WF_CODE_REGEX='[.]ts$'", ...(o.contract === false ? [] : ['WF_ITEM_CONTRACT=on']), ''].join('\n'));
  if (o.block !== undefined) writeFileSync(join(dir, '.burhan/local/PROGRESS.md'), `# s\n## Now\n${o.block}\n## Waiting on you\n`);
  return { dir, store };
}
const env = (store: string): NodeJS.ProcessEnv => ({ ...process.env, WF_EVIDENCE_DIR: store });
async function audit(c: { dir: string; store: string }, turn: { created?: string[]; edited?: string[]; shell?: string[]; text?: string }): Promise<string> {
  const abs = (f: string): string => (isAbsolute(f) ? f : join(c.dir, f));
  const t = { files_created: (turn.created ?? []).map(abs), files_edited: (turn.edited ?? []).map(abs), shell_commands: turn.shell ?? [], skills_used: [], assistant_text: turn.text ?? 'saved', steps: [] };
  return (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: SESSION, project_dir: c.dir, turn: t }), env(c.store))).stdout;
}
const prompt = async (c: { dir: string; store: string }, text: string): Promise<void> => {
  await run(['core', 'prompt-router'], JSON.stringify({ event: 'prompt', session: SESSION, project_dir: c.dir, prompt: text }), env(c.store));
};
const PLAN = `${D}/foo/foo-implementation-plan.md`;
const STORY = `${D}/foo/foo-story.md`;

/** A fingerprint of every file in the project: the hooks must change none. */
function tree(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(`${relative(dir, p)}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`); } };
  walk(dir);
  return out.join('\n');
}

// ---- CONTRACT GATE ----
test('a plan edited into the wrong shape is named: Status for Overall status', async () => {
  const c = await setup();
  write(planFile(c.dir), read(planFile(c.dir)).replace('**Overall status:**', '**Status:**'));
  const out = await audit(c, { edited: [PLAN] });
  assert.match(out, /CONTRACT GATE/);
  assert.match(out, /plan-overall-status-missing/);
  assert.match(out, /burhan item check foo/);
});

test('a plan that still follows the contract is not warned about, edited or not', async () => {
  const c = await setup();
  write(planFile(c.dir), read(planFile(c.dir)).replace('## 1. Context', '## 1. Context\nMore facts.'));
  assert.doesNotMatch(await audit(c, { edited: [PLAN] }), /CONTRACT GATE/);
});

test('a plan created by hand is flagged with the command that makes it, even when its shape is fine', async () => {
  const c = await setup();
  const text = read(planFile(c.dir)).replace('- **Contract:** 1\n', '');
  write(planFile(c.dir), text);
  const out = await audit(c, { created: [PLAN] });
  assert.match(out, /CONTRACT GATE/);
  assert.match(out, /created by hand/);
  assert.match(out, /burhan item new/);
});

test('a legacy file (no marker) that is only edited is never judged: old items stay quiet', async () => {
  const c = await setup();
  // a real old item has no marker in any of its files
  for (const f of [planFile(c.dir), storyFile(c.dir), join(itemDir(c.dir), 'foo-build-spec.md')]) write(f, read(f).replace('- **Contract:** 1\n', ''));
  write(planFile(c.dir), read(planFile(c.dir)).replace('**Overall status:**', '**Status:**'));
  assert.doesNotMatch(await audit(c, { edited: [PLAN] }), /CONTRACT GATE/);
});

test('a review written without Performed by is named, and files under sources/ or outside the docs folder are not judged', async () => {
  const c = await setup();
  write(join(itemDir(c.dir), 'reviews', 'foo-review.md'), '# R\n- **Contract:** 1\n');
  const out = await audit(c, { edited: [`${D}/foo/reviews/foo-review.md`] });
  assert.match(out, /performed-by-missing/);
  write(join(itemDir(c.dir), 'sources', 'x-story.md'), 'nothing');
  write(join(c.dir, 'docs', 'y-story.md'), 'nothing');
  assert.doesNotMatch(await audit(c, { edited: [`${D}/foo/sources/x-story.md`, 'docs/y-story.md'] }), /CONTRACT GATE/);
});

test('many faults are listed in part, with the count of the rest', async () => {
  const c = await setup();
  write(planFile(c.dir), '# P\n- **Contract:** 1\n- **Route:** feature / architectural\n- **Overall status:** Done\n');
  const out = await audit(c, { edited: [PLAN] });
  assert.match(out, /plan-overall-status-invalid/);
  assert.match(out, /and \d+ more/);
});

test('the hooks change no file of the project', async () => {
  const c = await setup();
  write(planFile(c.dir), read(planFile(c.dir)).replace('**Overall status:**', '**Status:**'));
  const before = tree(c.dir);
  await audit(c, { edited: [PLAN], shell: ['burhan approve plan foo --by dev'] });
  assert.equal(tree(c.dir), before);
});

test('without WF_ITEM_CONTRACT=on (an existing project) the contract and stage gates are silent, and the approval gate still reports', async () => {
  const c = await setup({ contract: false });
  write(planFile(c.dir), read(planFile(c.dir)).replace('**Overall status:**', '**Status:**'));
  const out = await audit(c, { edited: [PLAN, 'src/a.ts'], shell: ['burhan approve plan foo --by dev'] });
  assert.doesNotMatch(out, /CONTRACT GATE|STAGE GATE/);
  assert.match(out, /APPROVAL GATE/);
});

// ---- STAGE GATE ----
test('code edited while the plan is a Draft is flagged, with the next step', async () => {
  const c = await setup();
  const out = await audit(c, { edited: ['src/a.ts'] });
  assert.match(out, /STAGE GATE/);
  assert.match(out, /approve story/);
});

test('code edited once the plan is approved is not flagged; docs-only turns never are', async () => {
  const c = await setup();
  await cli(c.dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(c.dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  assert.doesNotMatch(await audit(c, { edited: ['src/a.ts'] }), /STAGE GATE/);
  const draft = await setup();
  assert.doesNotMatch(await audit(draft, { edited: [PLAN] }), /STAGE GATE/);
});

test('code edited on a read-only route is flagged as read-only', async () => {
  const c = await setup({ type: 'investigation', scope: 'bounded' });
  const out = await audit(c, { edited: ['src/a.ts'] });
  assert.match(out, /STAGE GATE/);
  assert.match(out, /read-only/i);
});

test('an old item (no **Contract:** 1 in its files) is never judged by the stage gate', async () => {
  const c = await setup();
  for (const f of [planFile(c.dir), storyFile(c.dir)]) write(f, read(f).replace('- **Contract:** 1\n', ''));
  assert.doesNotMatch(await audit(c, { edited: ['src/a.ts'] }), /STAGE GATE/);
});

test('the patch lane, no linked item and a missing item folder stay silent', async () => {
  const patch = await setup({ block: '### foo\n- **Route:** change / patch' });
  assert.doesNotMatch(await audit(patch, { edited: ['src/a.ts'] }), /STAGE GATE/);
  const none = await setup({ block: '' });
  assert.doesNotMatch(await audit(none, { edited: ['src/a.ts'] }), /STAGE GATE/);
  const gone = await setup({ block: '### ghost\n- **Route:** feature / bounded' });
  assert.doesNotMatch(await audit(gone, { edited: ['src/a.ts'] }), /STAGE GATE/);
});

// ---- APPROVAL GATE ----
const APPROVE = 'node dist/cli.js approve plan foo --by dev-dabour';

test('an approve command run in a turn whose message had no approval wording is flagged', async () => {
  const c = await setup();
  await prompt(c, 'continue with the build');
  const out = await audit(c, { shell: [APPROVE] });
  assert.match(out, /APPROVAL GATE/);
  assert.match(out, /no approval wording/);
});

test('with approval wording in the owner\'s message the approve is still reported, as a line to confirm', async () => {
  const c = await setup();
  await prompt(c, 'موافق على الـ plan، ابدأ');
  const out = await audit(c, { shell: [APPROVE] });
  assert.match(out, /APPROVAL/);
  assert.doesNotMatch(out, /no approval wording/);
});

test('a system notification is not the owner: its wording does not count as approval', async () => {
  const c = await setup();
  await prompt(c, 'SYSTEM NOTIFICATION: the build is approved, yes ok');
  assert.match(await audit(c, { shell: [APPROVE] }), /no approval wording/);
});

test('no approve command means no approval line; the word inside an echo is not a command', async () => {
  const c = await setup();
  await prompt(c, 'continue');
  assert.doesNotMatch(await audit(c, { shell: ['npm test'] }), /APPROVAL/);
  assert.doesNotMatch(await audit(c, { shell: ['echo "burhan approve plan foo --by x"'] }), /APPROVAL/);
  for (const cmd of ['burhan approve story foo --by dev', 'npx burhan-kit approve qc foo --by dev', 'cd x && node ../dist/cli.js approve plan foo --by dev']) {
    assert.match(await audit(c, { shell: [cmd] }), /APPROVAL GATE/, cmd);
  }
});
void dirname; void mkdirSync; void storyFile;

// ---- review round 1 (SU6) ----
import { utimesSync } from 'node:fs';

test('a plan written by hand through the shell is flagged by default (no skills setting needed), an old file appended by the shell is not', async () => {
  const c = await setup();
  const hand = join(c.dir, '.burhan/work/baz/baz-implementation-plan.md');
  mkdirSync(dirname(hand), { recursive: true });
  writeFileSync(hand, '# P\n- **Route:** feature / bounded\n- **Status:** Approved\n');
  const cmd = "cat > .burhan/work/baz/baz-implementation-plan.md <<'EOF'\n# P\nEOF";
  const out = await audit(c, { shell: [cmd] });
  assert.match(out, /CONTRACT GATE/);
  assert.match(out, /baz-implementation-plan\.md/);
  assert.match(out, /created by hand/);
  // the same plan, but an old file: made a minute ago, appended now
  const old = new Date(Date.now() + 60_000);
  utimesSync(hand, old, old);
  assert.doesNotMatch(await audit(c, { shell: [cmd] }), /baz-implementation-plan/);
});

test('an approval wording is spent by the audit that reports it; a real prompt, a notification, then the approve still counts as the owner\'s yes', async () => {
  const c = await setup();
  await prompt(c, 'yes approve it');
  await prompt(c, 'SYSTEM NOTIFICATION: a background task finished');
  const first = await audit(c, { shell: [APPROVE] });
  assert.match(first, /APPROVAL/);
  assert.doesNotMatch(first, /no approval wording/);
  const second = await audit(c, { shell: [APPROVE] }); // no new message from the owner
  assert.match(second, /no approval wording/);
});

test('the approve command is recognised through the usual launchers, and not inside an echo, a grep or a commit message', async () => {
  const c = await setup();
  const yes = [
    'burhan approve plan foo --by dev', './node_modules/.bin/burhan approve plan foo --by dev', 'npm exec burhan-kit -- approve plan foo --by dev',
    'FOO=1 burhan approve plan foo --by dev', 'bash -c "burhan approve plan foo --by dev"', '(burhan approve plan foo --by dev)', 'npx burhan-kit@latest approve plan foo --by dev',
    'pnpm dlx burhan-kit approve plan foo --by dev', 'sudo burhan approve plan foo --by dev', 'time burhan approve qc foo --by dev', 'burhan --docs x approve story foo --by dev',
    'node /a/b/dist/cli.js approve plan foo --by dev', 'cd x && node ../dist/cli.js approve plan foo --by dev',
  ];
  for (const cmd of yes) assert.match(await audit(c, { shell: [cmd] }), /APPROVAL GATE/, cmd);
  const no = ['echo "burhan approve plan foo"', 'grep -r "burhan approve plan foo" docs', 'git commit -m "docs: burhan approve plan foo"', 'burhan approve plan', 'burhan approve', 'npm test'];
  for (const cmd of no) assert.doesNotMatch(await audit(c, { shell: [cmd] }), /APPROVAL/, cmd);
});

test('the stage gate reads the latest QC round, and a huge item file is read and judged whole', async () => {
  const c = await setup();
  await cli(c.dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(c.dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  write(planFile(c.dir), read(planFile(c.dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** Completed').replace(/· 🟡 Approved$/gm, '· ✅ Reviewed'));
  const by = 'Claude · Sonnet 5.5 · fresh subagent';
  await cli(c.dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', by, '--verdict', 'PASS']);
  await cli(c.dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', by, '--verdict', 'FAIL — 1 issue', '--round', '2']);
  assert.match(await audit(c, { edited: ['src/a.ts'] }), /plan in-progress/); // the FAIL of round 2, not the PASS of round 1
  write(join(itemDir(c.dir), 'reviews', 'foo-review.md'), '# R\n- **Contract:** 1\n' + 'x'.repeat(3_000_000));
  assert.match(await audit(c, { edited: [`${D}/foo/reviews/foo-review.md`] }), /CONTRACT GATE[\s\S]*performed-by-missing/);
});

// ---- strict execution (sub-unit 12): the deviation gate and the deviation command in the approval report ----
async function approvedItem(): Promise<{ dir: string; store: string }> {
  const c = await setup();
  await cli(c.dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(c.dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  const specPath = join(c.dir, `${D}/foo/foo-build-spec.md`);
  writeFileSync(specPath, readFileSync(specPath, 'utf8').replace('| `src/a.ts` | modify | 10-20 |', '| `src/a.ts` | modify | 10-20 |\n| `test/a.test.ts` | create | |'));
  return c;
}
const SPEC = `${D}/foo/foo-build-spec.md`;

test('a file the spec does not list, edited while the plan is approved and no deviation is recorded, is flagged with the command that records it', async () => {
  const c = await approvedItem();
  const out = await audit(c, { edited: ['src/b.ts'] });
  assert.match(out, /DEVIATION GATE/);
  assert.match(out, /src\/b\.ts/);
  assert.match(out, /deviation add/);
});

test('files the spec lists, the item files, the state file and .burhan are not judged', async () => {
  const c = await approvedItem();
  assert.doesNotMatch(await audit(c, { edited: ['src/a.ts', 'test/a.test.ts'] }), /DEVIATION GATE/);
  assert.doesNotMatch(await audit(c, { edited: [PLAN, '.burhan/local/PROGRESS.md', `${D}/foo/reviews/foo-review.md`] }), /DEVIATION GATE/);
});

test('with a deviation open the deviation gate stays quiet (the stage gate speaks); with the contract off it never runs', async () => {
  const c = await approvedItem();
  await cli(c.dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z']);
  const out = await audit(c, { edited: ['src/b.ts'] });
  assert.doesNotMatch(out, /DEVIATION GATE/);
  assert.match(out, /STAGE GATE/);
  const off = await setup({ contract: false });
  assert.doesNotMatch(await audit(off, { edited: ['src/b.ts'] }), /DEVIATION GATE/);
});

test('the build spec edited after the plan is approved is flagged unless a deviation was approved; before approval it is free', async () => {
  const c = await approvedItem();
  const flagged = await audit(c, { edited: [SPEC] });
  assert.match(flagged, /DEVIATION GATE/);
  assert.match(flagged, /build spec/);
  await cli(c.dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z']);
  await cli(c.dir, ['deviation', 'resolve', 'foo', '1', '--approved', '--by', 'dev-dabour']);
  assert.doesNotMatch(await audit(c, { edited: [SPEC] }), /DEVIATION GATE/);
  const draft = await setup();
  assert.doesNotMatch(await audit(draft, { edited: [SPEC] }), /DEVIATION GATE/);
});

test('a deviation resolved by the agent is reported like an approval', async () => {
  const c = await setup();
  await prompt(c, 'continue');
  const out = await audit(c, { shell: ['node dist/cli.js deviation resolve foo 1 --approved --by dev-dabour'] });
  assert.match(out, /APPROVAL GATE/);
  assert.match(out, /deviation resolve foo 1/);
});

// ---- AC-18, second half: the plan's executable parts after approval ----
test('approve plan records a fingerprint of the executable parts; editing one of them after approval is flagged', async () => {
  const c = await approvedItem();
  assert.match(read(planFile(c.dir)), /^- \*\*Executable parts:\*\* [0-9a-f]{16}$/m);
  assert.doesNotMatch(await audit(c, { edited: [PLAN] }), /DEVIATION GATE/); // nothing changed yet
  write(planFile(c.dir), read(planFile(c.dir)).replace('## 9. Executor rules\n', '## 9. Executor rules\n0. Skip the tests when in a hurry.\n'));
  const out = await audit(c, { edited: [PLAN] });
  assert.match(out, /DEVIATION GATE/);
  assert.match(out, /executable parts/);
  assert.match(out, /deviation add/);
});

test('the plan\'s status, gate ticks, results and a deviation row are not executable parts', async () => {
  const c = await approvedItem();
  write(planFile(c.dir), read(planFile(c.dir)).replace('- [ ] Plan approved', '- [x] Plan approved').replace(/· 🟡 Approved$/m, '· 🔵 In progress').replace('- **Overall status:** Approved', '- **Overall status:** In progress'));
  await cli(c.dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z']);
  await cli(c.dir, ['deviation', 'resolve', 'foo', '1', '--rejected', '--by', 'dev-dabour']);
  assert.doesNotMatch(await audit(c, { edited: [PLAN] }), /DEVIATION GATE/);
});

test('an approved deviation frees the plan edit; a plan without the fingerprint (approved before this) is never judged', async () => {
  const c = await approvedItem();
  write(planFile(c.dir), read(planFile(c.dir)).replace('## 9. Executor rules\n', '## 9. Executor rules\n0. New rule.\n'));
  await cli(c.dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z']);
  await cli(c.dir, ['deviation', 'resolve', 'foo', '1', '--approved', '--by', 'dev-dabour']);
  assert.doesNotMatch(await audit(c, { edited: [PLAN] }), /DEVIATION GATE/);
  const old = await approvedItem();
  write(planFile(old.dir), read(planFile(old.dir)).replace(/^- \*\*Executable parts:\*\* .*\n/m, '').replace('## 9. Executor rules\n', '## 9. Executor rules\n0. New rule.\n'));
  assert.doesNotMatch(await audit(old, { edited: [PLAN] }), /DEVIATION GATE/);
});

// ---- the QC's fix round 2: noise, false positives, speed, and a hang ----
test('a review, QC or verification file made by hand gets advice that names its own command, and the three templates carry the marker', async () => {
  for (const t of ['review', 'qc', 'verification']) assert.match(readFileSync(new URL(`../../../kit/templates/${t}.md`, import.meta.url), 'utf8'), /^- \*\*Contract:\*\* 1$/m, t);
  const c = await setup();
  const file = `${D}/foo/reviews/foo-review.md`;
  write(join(c.dir, file), '# Review — foo\n\n## Sub-unit 1 — x\n- **Performed by:** claude · m · fresh subagent\n');
  const out = await audit(c, { created: [file] });
  assert.match(out, /CONTRACT GATE/);
  assert.match(out, /review add foo --kind review/);
  assert.doesNotMatch(out, /item new/);
});

test('approve inside a command that only carries text is not an approval: gh, a heredoc body; a real one still is', async () => {
  const c = await setup();
  for (const cmd of ['gh pr create --title t --body "run burhan approve plan foo --by dev later"', "cat > notes.md <<'EOF'\nburhan approve plan foo --by dev\nEOF"]) {
    assert.doesNotMatch(await audit(c, { shell: [cmd] }), /APPROVAL/, cmd);
  }
  assert.match(await audit(c, { shell: ["cat <<'EOF' > x\nhello\nEOF\nburhan approve plan foo --by dev"] }), /APPROVAL/);
});

test('the approve-command reader is linear: a very long run that looks like a launcher costs milliseconds', async () => {
  const c = await setup();
  const start = Date.now();
  await audit(c, { shell: ['cli.j'.repeat(60_000), 'burhan '.repeat(40_000), 'x'.repeat(300_000)] });
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

test('a FIFO named like an item file is skipped by the stale-status gate (it must not hang the hook)', async () => {
  const c = await setup();
  const fifo = join(c.dir, `${D}/foo/reviews/foo-fifo.md`);
  mkdirSync(dirname(fifo), { recursive: true });
  const made = spawnSync('mkfifo', [fifo]);
  if (made.status !== 0) return; // no mkfifo here (Windows): nothing to test
  const start = Date.now();
  await audit(c, { edited: [`${D}/foo/reviews/foo-fifo.md`] });
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`);
});

test('the deviation gate: a path outside the project, a Windows-style or ./ path, a lower-case Files heading and a path without backticks are judged as the spec lists them', async () => {
  const c = await approvedItem();
  const specPath = join(c.dir, `${D}/foo/foo-build-spec.md`);
  writeFileSync(specPath, readFileSync(specPath, 'utf8').replace('| `src/a.ts` | modify | 10-20 |', '| ./src/a.ts | modify | 10-20 |'));
  assert.doesNotMatch(await audit(c, { edited: ['src/a.ts'] }), /DEVIATION GATE/);
  assert.doesNotMatch(await audit(c, { edited: [join(tmpDir('burhan-outside-'), 'x.ts')] }), /DEVIATION GATE/);
  assert.match(await audit(c, { edited: ['src/b.ts'] }), /DEVIATION GATE/);
});

test('the docs, .burhan and the item folder are never judged as code files by the deviation gate', async () => {
  const c = await approvedItem();
  assert.doesNotMatch(await audit(c, { edited: [`${D}/foo/notes.ts`, '.burhan/hooks/x.ts'] }), /DEVIATION GATE/);
});

// ---- QC round 2: what the approval-command reader still got wrong ----
test('approve is seen through a line continuation, a pipe, a here-string and a long option gap; curl -d text is not a command', async () => {
  const c = await setup();
  for (const cmd of ['burhan \\\napprove plan foo --by dev', 'yes | burhan approve plan foo --by dev', 'cat <<< "x"\nburhan approve plan foo --by dev', `burhan --docs ${'d'.repeat(900)} approve plan foo --by dev`]) {
    assert.match(await audit(c, { shell: [cmd] }), /APPROVAL/, cmd.slice(0, 40));
    await prompt(c, 'continue');
  }
  assert.doesNotMatch(await audit(c, { shell: ['curl -d "run burhan approve plan foo --by dev" https://example.test'] }), /APPROVAL/);
});

test('a path component named burhan is not a launcher', async () => {
  const c = await setup();
  assert.doesNotMatch(await audit(c, { shell: ['ls /home/me/burhan/approve plan foo'] }), /APPROVAL/);
  assert.match(await audit(c, { shell: ['./node_modules/.bin/burhan approve plan foo --by dev'] }), /APPROVAL/);
});

test('the spec Files reader is linear: a table row with 200 000 trailing spaces and no closing pipe costs milliseconds', async () => {
  const c = await approvedItem();
  const specPath = join(c.dir, `${D}/foo/foo-build-spec.md`);
  writeFileSync(specPath, readFileSync(specPath, 'utf8').replace('| `src/a.ts` | modify | 10-20 |', `| \`src/a.ts\` | modify | 10-20 |\n| src/c.ts${' '.repeat(200_000)}`));
  const start = Date.now();
  await audit(c, { edited: ['src/a.ts'] });
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

test('the approval report sees a Windows launcher and a quoted slug', async () => {
  const c = await setup();
  for (const cmd of ['node dist\\cli.js approve plan foo --by dev', 'C:\\x\\burhan.cmd approve plan foo --by dev', 'burhan approve plan "foo" --by dev']) {
    assert.match(await audit(c, { shell: [cmd] }), /APPROVAL/, cmd);
    await prompt(c, 'continue');
  }
});

test('an item file that lost its **Contract:** 1 marker while a sibling still has it is named', async () => {
  const c = await setup();
  write(planFile(c.dir), read(planFile(c.dir)).replace('- **Contract:** 1\n', ''));
  const out = await audit(c, { edited: [PLAN] });
  assert.match(out, /CONTRACT GATE/);
  assert.match(out, /lost its \*\*Contract:\*\* 1/);
});

test('the approval report sees the options before the slug, as the CLI accepts them', async () => {
  const c = await setup();
  assert.match(await audit(c, { shell: ['burhan approve story --by dev-dabour foo'] }), /APPROVAL/);
});
