import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, symlinkSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/main.js';
import { install } from '../src/lib/install.js';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import type { SetupAnswers } from '../src/lib/setup/answers.js';
import { applyBlock, removeBlock } from '../src/lib/bootstrap.js';
import { removeHooks, type Settings } from '../src/lib/hooks-merge.js';
import { capture, posixOnly, tmpDir } from './helpers.js';

const home = tmpDir('burhan-un-home-');

function fresh(): string {
  const d = tmpDir('burhan-un-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir)) {
    if (e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out[p.slice(base.length) + '/'] = ''; tree(p, base, out); }
    else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}
const hash = (dir: string): string => createHash('sha256').update(JSON.stringify(tree(dir))).digest('hex');
const put = (t: string, rel: string, text: string): void => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), text); };
const has = (t: string, rel: string): boolean => existsSync(join(t, rel));
const answers = (o: Partial<SetupAnswers> = {}): SetupAnswers => ({ agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en', ...o });
const setup = (t: string, o: Partial<SetupAnswers> = {}): void => applySetup(planSetup(t, answers(o), home));
const un = async (t: string, ...args: string[]) => { const c = capture(t); const code = await runCli(['uninstall', t, ...args], c.io); return { code, out: c.o.out, err: c.o.err }; };

test('keeps the user\'s own CLAUDE.md text and settings.json hook byte-identical', async () => {
  const t = fresh();
  const claudeMd = '# Mine\n\nUse tabs.\n';
  const settings = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2) + '\n';
  put(t, 'CLAUDE.md', claudeMd);
  put(t, '.claude/settings.json', settings);
  setup(t);
  assert.notEqual(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), claudeMd);
  const r = await un(t, '--apply');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), claudeMd);
  assert.equal(readFileSync(join(t, '.claude/settings.json'), 'utf8'), settings);
  assert.equal(has(t, '.burhan/hooks'), false);
  assert.equal(has(t, '.burhan/WORKFLOW.md'), false);
  assert.equal(has(t, '.claude/commands/burhan'), false);
});

test('fresh repo: install then uninstall --apply --all restores the pre-install tree', async () => {
  const t = fresh();
  put(t, 'src/app.txt', 'x\n');
  const before = tree(t);
  setup(t);
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(tree(t), before); // incl. no leftover empty .claude/ .burhan/ .burhan/ folders
});

test('same for a plain install() without setup (config + bindings created from templates)', async () => {
  const t = fresh();
  const before = tree(t);
  assert.equal(install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: true }, capture(t).io), 0);
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(tree(t), before);
});

test('a .claude file without the burhan mark survives; so does a non-kit file inside .burhan/ (and is listed)', async () => {
  const t = fresh();
  put(t, '.claude/agents/mine.md', '---\nname: mine\n---\nhello\n');
  put(t, '.claude/commands/other.md', 'no mark\n');
  setup(t);
  put(t, '.burhan/notes.md', 'my notes\n');
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(t, '.claude/agents/mine.md'), 'utf8'), '---\nname: mine\n---\nhello\n');
  assert.equal(readFileSync(join(t, '.claude/commands/other.md'), 'utf8'), 'no mark\n');
  assert.equal(readFileSync(join(t, '.burhan/notes.md'), 'utf8'), 'my notes\n');
  assert.match(r.out, /notes\.md/);
  assert.equal(has(t, '.burhan/WORKFLOW.md'), false);
  assert.equal(has(t, '.claude/agents/burhan-reviewer.md'), false);
});

test('a .claude/agents file that carries the mark is removed', async () => {
  const t = fresh();
  setup(t);
  assert.ok(has(t, '.claude/agents/burhan-reviewer.md'));
  await un(t, '--apply');
  assert.equal(has(t, '.claude/agents/burhan-reviewer.md'), false);
});

test('dry run changes nothing and lists what it would remove', async () => {
  const t = fresh();
  setup(t);
  const before = hash(t);
  const r = await un(t);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(hash(t), before);
  assert.match(r.out, /DRY RUN/i);
  for (const s of ['WORKFLOW.md', 'CLAUDE.md', '.claude/settings.json', '.claude/commands/burhan']) assert.ok(r.out.includes(s), `lists ${s}`);
  assert.match(r.out, /--apply/);
});

test('not installed: exit 2, "burhan: burhan is not installed"', async () => {
  const t = fresh();
  const before = hash(t);
  const r = await un(t, '--apply');
  assert.equal(r.code, 2);
  assert.match(r.err, /burhan: burhan is not installed/);
  assert.equal(hash(t), before);
});

test('R-9: plain uninstall keeps config, bindings, local/ and .burhan/work, and says kept', async () => {
  const t = fresh();
  setup(t);
  put(t, '.burhan/local/PROGRESS.md', 'state\n');
  put(t, '.burhan/work/item/story.md', 'story\n');
  const r = await un(t, '--apply');
  assert.equal(r.code, 0, r.err + r.out);
  for (const k of ['.burhan/workflow.config', '.burhan/bindings.md', '.burhan/local/PROGRESS.md', '.burhan/work/item/story.md']) assert.ok(has(t, k), `kept ${k}`);
  assert.match(r.out, /kept:/);
  for (const k of ['workflow.config', 'bindings.md', 'local', 'work']) assert.ok(r.out.includes(k), `says kept ${k}`);
  assert.equal(has(t, '.burhan/.gitignore'), true); // I-5 (a): kept while .burhan/work is kept
  assert.equal(has(t, '.burhan/WORKFLOW.md'), false);
});

test('R-9: --all removes config, bindings, local/ and the work folder inside .burhan/', async () => {
  const t = fresh();
  setup(t);
  put(t, '.burhan/local/PROGRESS.md', 'state\n');
  put(t, '.burhan/work/item/story.md', 'story\n');
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  for (const k of ['.burhan', '.burhan']) assert.equal(has(t, k), false, `${k} gone`);
});

test('R-9: --all never removes a work-files folder outside .burhan/ and .burhan/', async () => {
  const t = fresh();
  setup(t, { docs: { kind: 'custom', path: 'docs/work' } });
  put(t, 'docs/work/item/story.md', 'story\n');
  put(t, 'docs/work-discovery/d.md', 'd\n');
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(t, 'docs/work/item/story.md'), 'utf8'), 'story\n');
  assert.ok(has(t, 'docs/work-discovery/d.md'));
  assert.match(r.out, /docs\/work/);
  assert.equal(has(t, '.burhan'), false);
});

test('codex: an install with claude+codex is fully reversed', async () => {
  const t = fresh();
  const before = tree(t);
  setup(t, { agents: ['claude', 'codex'] });
  assert.ok(has(t, '.codex/hooks.json') && has(t, 'AGENTS.md'));
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(has(t, '.codex/hooks.json'), false);
  assert.equal(has(t, 'AGENTS.md'), false);
  assert.deepEqual(tree(t), before);
});

test('codex: the user\'s own AGENTS.md text and hooks.json entry survive', async () => {
  const t = fresh();
  const agents = '# Agents\n\nBe brief.\n';
  const hooks = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }, null, 2) + '\n';
  put(t, 'AGENTS.md', agents);
  put(t, '.codex/hooks.json', hooks);
  setup(t, { agents: ['claude', 'codex'] });
  await un(t, '--apply');
  assert.equal(readFileSync(join(t, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(readFileSync(join(t, '.codex/hooks.json'), 'utf8'), hooks);
});

// ASSUMPTION (plan gap): burhan cannot know whether it created settings.json. A settings file that holds
// nothing but burhan's hooks (no other key, no other entry) is deleted; any other key or entry keeps it.
test('settings.json with another top-level key (even after our hooks go) is kept, hooks key dropped if empty', async () => {
  const t = fresh();
  put(t, '.claude/settings.json', JSON.stringify({ model: 'opus' }, null, 2) + '\n');
  setup(t);
  await un(t, '--apply');
  assert.deepEqual(JSON.parse(readFileSync(join(t, '.claude/settings.json'), 'utf8')), { model: 'opus' });
});

// ---- unit: removeBlock / removeHooks
test('removeBlock: apply then remove restores the file byte-exact (LF and CRLF)', () => {
  for (const nl of ['\n', '\r\n']) {
    const mine = `# Mine${nl}${nl}rules${nl}`;
    const withBlock = applyBlock(mine, 'claude', '1.0.0').content;
    assert.deepEqual(removeBlock(withBlock), { content: mine });
  }
});

test('removeBlock: text before and after the block is kept; no marker remains', () => {
  const block = applyBlock(null, 'claude', '1.0.0').content.trimEnd();
  const out = removeBlock(`before line\n${block}\nafter line\n`).content;
  assert.ok(out !== null && out.startsWith('before line\n') && out.endsWith('after line\n'));
  assert.ok(!out!.includes('burhan'));
  const crlf = removeBlock(`before\r\n${block.replace(/\n/g, '\r\n')}\r\nafter\r\n`).content;
  assert.ok(crlf !== null && crlf.startsWith('before\r\n') && crlf.endsWith('after\r\n') && !crlf.includes('burhan'));
});

test('removeBlock: a file that is only the block → null; no block → unchanged', () => {
  assert.deepEqual(removeBlock(applyBlock(null, 'codex', '1.0.0').content), { content: null });
  assert.deepEqual(removeBlock('# just mine\n'), { content: '# just mine\n' });
});

const M = '.burhan/hooks/adapters/claude/hook.sh';
const C = (x: string): string => `bash ${M} ${x}`; // stand-ins for the commands burhan installs
test('removeHooks: only marker entries go; emptied groups/events vanish; other keys and entries stay', () => {
  const s: Settings = { model: 'x', hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }, { type: 'command', command: C('pre') }] }, { hooks: [{ command: C('x') }] }],
    Stop: [{ hooks: [{ command: C('stop') }] }],
  } };
  const out = removeHooks(s, [C('pre'), C('x'), C('stop')]);
  assert.deepEqual(out, { model: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } });
});

test('removeHooks: nothing else left → null; other keys left → object without "hooks"', () => {
  assert.equal(removeHooks({ hooks: { Stop: [{ hooks: [{ command: C('a') }] }] } }, [C('a')]), null);
  assert.deepEqual(removeHooks({ model: 'x', hooks: { Stop: [{ hooks: [{ command: C('a'), timeout: 5 }] }] } }, [C('a')]), { model: 'x' });
});

// ---- review findings (sub-unit 7)
const outside = (): string => tmpDir('burhan-un-out-');
const MARKED = '---\nname: victim\n---\n<!-- managed by burhan — run `burhan upgrade` to update -->\nbody\n';

test('I-1a: .claude symlinked outside the project: the outside files and dir are untouched, the skip is reported', async () => {
  const t = fresh(); const out = outside();
  setup(t);
  rmSync(join(t, '.claude'), { recursive: true });
  put(out, 'agents/victim.md', MARKED);
  symlinkSync(out, join(t, '.claude'));
  const before = hash(out);
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(hash(out), before);
  assert.ok(has(out, 'agents/victim.md'));
  assert.match(r.out, /symlink|link/i);
});

test('I-1b: .burhan symlinked outside + --all: the outside dir is untouched', async () => {
  const t = fresh(); const out = outside();
  setup(t);
  rmSync(join(t, '.burhan'), { recursive: true, force: true });
  put(out, 'work/f', 'x\n');
  put(out, 'WORKFLOW.md', 'installed kit marker\n');
  symlinkSync(out, join(t, '.burhan'));
  const before = hash(out);
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(hash(out), before);
});

test('I-1c: a symlinked docs dir under .burhan/ + --all: its target is untouched', async () => {
  const t = fresh(); const out = outside();
  setup(t);
  rmSync(join(t, '.burhan/work'), { recursive: true, force: true });
  put(out, 'item/story.md', 's\n');
  symlinkSync(out, join(t, '.burhan/work'));
  const before = hash(out);
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(hash(out), before);
});

for (const docs of ['.burhan', '.burhan/x', '.claude', '.codex']) {
  test(`I-2: --all with WF_DOCS_DIR=${docs} keeps it and the foreign files, and lists it as kept`, async () => {
    const t = fresh();
    setup(t);
    writeFileSync(join(t, '.burhan/workflow.config'), readFileSync(join(t, '.burhan/workflow.config'), 'utf8') + `\nWF_DOCS_DIR="${docs}"\n`);
    put(t, `${docs}/mine.txt`, 'mine\n');
    if (docs === '.burhan') put(t, '.burhan/other.txt', 'other\n');
    const r = await un(t, '--apply', '--all');
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(readFileSync(join(t, `${docs}/mine.txt`), 'utf8'), 'mine\n');
    assert.ok(has(t, docs));
    assert.match(r.out, new RegExp(`kept:.*${docs.replace('.', '\\.')}`));
  });
}

test('I-3: a read-only .claude/commands/burhan: --apply exits 2 "nothing was changed", tree unchanged; dry run says BLOCKED', { skip: posixOnly }, async () => {
  const t = fresh();
  setup(t);
  const dir = join(t, '.claude/commands/burhan');
  chmodSync(dir, 0o555);
  try {
    const before = hash(t);
    const dry = await un(t);
    assert.match(dry.out, /BLOCKED/);
    assert.equal(hash(t), before);
    const r = await un(t, '--apply');
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /burhan: .* — nothing was changed/);
    assert.equal(hash(t), before);
  } finally { chmodSync(dir, 0o755); }
});

test('I-3: a broken block pair changes nothing (validated before the first write)', async () => {
  const t = fresh();
  setup(t);
  writeFileSync(join(t, 'CLAUDE.md'), readFileSync(join(t, 'CLAUDE.md'), 'utf8') + '\n<!-- burhan:start -->\n');
  const before = hash(t);
  const r = await un(t, '--apply');
  assert.equal(r.code, 2);
  assert.equal(hash(t), before);
});

test('I-4: a user file that quotes the mark in prose or in a code block survives; a real marked file goes', async () => {
  const t = fresh();
  setup(t);
  put(t, '.claude/notes.md', 'Files with <!-- managed by burhan — x --> in them are ours.\n');
  put(t, '.claude/notes2.md', 'How it looks:\n\n```\n<!-- managed by burhan — run `burhan upgrade` -->\n```\n');
  put(t, '.claude/notes3.md', '---\nname: n\n---\ntext <!-- managed by burhan — inline -->\n');
  put(t, '.claude/agents/victim.md', MARKED);
  const r = await un(t, '--apply', '--all');
  assert.equal(r.code, 0, r.err + r.out);
  for (const f of ['notes.md', 'notes2.md', 'notes3.md']) assert.ok(has(t, `.claude/${f}`), `${f} survives`);
  assert.equal(has(t, '.claude/agents/victim.md'), false);
  assert.equal(has(t, '.claude/commands/burhan'), false);
});

test('M-1: a user hook whose command merely mentions the adapter path survives; burhan\'s own go', async () => {
  const t = fresh();
  setup(t);
  const f = join(t, '.claude/settings.json');
  const s = JSON.parse(readFileSync(f, 'utf8')) as Settings;
  const mine = 'echo .burhan/hooks/adapters/claude/hook.sh';
  s.hooks!.Stop = [...(s.hooks!.Stop ?? []), { hooks: [{ type: 'command', command: mine }] }];
  writeFileSync(f, JSON.stringify(s, null, 2));
  const r = await un(t, '--apply');
  assert.equal(r.code, 0, r.err + r.out);
  const after = JSON.parse(readFileSync(f, 'utf8')) as Settings;
  assert.deepEqual(after, { hooks: { Stop: [{ hooks: [{ type: 'command', command: mine }] }] } });
});

test('I-5: plain uninstall keeps the scoped ignore file and private data stays ignored', async () => {
  const t = fresh();
  setup(t);
  put(t, '.burhan/local/PROGRESS.md', 'state\n');
  put(t, '.burhan/work/item/story.md', 'story\n');
  const r = await un(t, '--apply');
  assert.equal(r.code, 0, r.err + r.out);
  assert.ok(readFileSync(join(t, '.burhan/.gitignore'), 'utf8').includes('local/'));
  assert.equal(readFileSync(join(t, '.burhan/.gitignore'), 'utf8'), '/local/\n/work/\n/discovery/\n');
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: t, encoding: 'utf8' }).stdout;
  assert.ok(!st.includes('.burhan/local/') && !st.includes('.burhan/work/'), st);
  assert.ok(st.includes('.burhan/workflow.config'), st);
});

test('I-5: --all removes the generated ignore file with empty protected folders', async () => {
  const t = fresh();
  setup(t);
  put(t, '.burhan/local/PROGRESS.md', 'state\n');
  put(t, '.burhan/work/item/story.md', 'story\n');
  await un(t, '--apply', '--all');
  assert.equal(has(t, '.burhan'), false);
});

for (const alias of ['.burhan', './.burhan/', '.burhan/context', '.burhan/PROJECT.md', '.burhan/work/../context']) {
  test(`--all cannot remove root or memory through configured alias ${alias}`, async () => {
    const target = fresh();
    setup(target);
    put(target, '.burhan/workflow.config', `WF_DOCS_DIR="${alias}"\nWF_DISCOVERY_DIR="${alias}"\n`);
    put(target, '.burhan/PROJECT.md', 'project memory\n');
    put(target, '.burhan/context/stack.md', 'stack memory\n');
    put(target, '.burhan/unknown.txt', 'unknown\n');
    const result = await un(target, '--apply', '--all');
    assert.equal(result.code, 0, result.err);
    assert.equal(readFileSync(join(target, '.burhan/PROJECT.md'), 'utf8'), 'project memory\n');
    assert.equal(readFileSync(join(target, '.burhan/context/stack.md'), 'utf8'), 'stack memory\n');
    assert.equal(readFileSync(join(target, '.burhan/unknown.txt'), 'utf8'), 'unknown\n');
  });
}

test('--all keeps user ignore rules even when no protected data remains', async () => {
  const target = fresh();
  setup(target);
  const text = '# mine\n/local/\n/work/\n/discovery/\n/cache/\n';
  put(target, '.burhan/.gitignore', text);
  const result = await un(target, '--apply', '--all');
  assert.equal(result.code, 0, result.err);
  assert.equal(readFileSync(join(target, '.burhan/.gitignore'), 'utf8'), text);
});

test('--all cannot remove memory through a symlink ancestor inside private work', async () => {
  const target = fresh();
  setup(target);
  put(target, '.burhan/context/stack.md', 'memory\n');
  put(target, '.burhan/PROJECT.md', 'project memory\n');
  put(target, '.burhan/work/item/story.md', 'private work\n');
  symlinkSync('..', join(target, '.burhan/work/link'));
  put(target, '.burhan/workflow.config', 'WF_DOCS_DIR=".burhan/work/link/context"\nWF_DISCOVERY_DIR=".burhan/work/link/PROJECT.md"\n');
  const result = await un(target, '--apply', '--all');
  assert.equal(result.code, 0, result.err);
  assert.equal(readFileSync(join(target, '.burhan/context/stack.md'), 'utf8'), 'memory\n');
  assert.equal(readFileSync(join(target, '.burhan/PROJECT.md'), 'utf8'), 'project memory\n');
  assert.equal(has(target, '.burhan/work'), false);
  for (const line of result.out.split('\n').filter((line) => line.includes('kept:'))) {
    const rel = /kept: (\S+)/.exec(line)![1];
    assert.ok(has(target, rel), line);
  }
});

test('never reports as "kept" a file the same run removes (confirmation review M-4)', async () => {
  const t = fresh(); setup(t);
  const { o, io } = capture(t);
  assert.equal(await runCli(['uninstall', t, '--apply'], io), 0);
  for (const line of o.out.split('\n').filter((l) => l.includes('kept:'))) {
    const rel = /kept: (\S+)/.exec(line)![1];
    assert.ok(has(t, rel), `"${line.trim()}" but ${rel} is gone`);
  }
});

// alerts-and-texts SU4 (AC-08): `--all` after a plain uninstall removes what `--all` removes today — no more, no less.
const withMemory = (t: string): void => {
  setup(t);
  put(t, '.burhan/local/PROGRESS.md', 'x\n');
  put(t, '.burhan/work/a/a-story.md', '# s\n');
  put(t, '.burhan/PROJECT.md', '# P\n');
  put(t, '.burhan/context/stack.md', '# c\n');
};
test('after a plain uninstall, --all (dry run, then --apply) ends with exactly the tree a direct --all leaves; project memory stays', async () => {
  const direct = fresh(); put(direct, 'src/app.txt', 'x\n'); withMemory(direct);
  assert.equal((await un(direct, '--apply', '--all')).code, 0);

  const later = fresh(); put(later, 'src/app.txt', 'x\n'); withMemory(later);
  assert.equal((await un(later, '--apply')).code, 0);
  const kept = tree(later);
  const dry = await un(later, '--all');
  assert.equal(dry.code, 0, dry.err + dry.out);
  assert.match(dry.out, /DRY RUN/);
  for (const rel of ['.burhan/workflow.config', '.burhan/bindings.md', '.burhan/local', '.burhan/work']) assert.match(dry.out, new RegExp(`remove ${rel.replace('.', '\\.')}`), rel);
  assert.deepEqual(tree(later), kept, 'the dry run changes nothing');
  const r = await un(later, '--all', '--apply');
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(tree(later), tree(direct), 'same result as a direct --all');
  assert.ok(has(later, '.burhan/PROJECT.md') && has(later, '.burhan/context/stack.md'), 'project memory stays');
  assert.equal(readFileSync(join(later, '.burhan/PROJECT.md'), 'utf8'), '# P\n');
});

test('after a plain uninstall: an unknown file in .burhan/ → --all refuses and removes nothing; plain again names --all', async () => {
  const t = fresh(); setup(t);
  assert.equal((await un(t, '--apply')).code, 0);
  const again = await un(t);
  assert.notEqual(again.code, 0);
  assert.match(again.err + again.out, /only your kept files remain; add --all to remove them/);
  put(t, '.burhan/notes.txt', 'mine\n');
  const before = tree(t);
  const r = await un(t, '--all', '--apply');
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /burhan is not installed/);
  assert.deepEqual(tree(t), before);
});

test('after a plain uninstall: .burhan as a symlink, or no .burhan at all → --all refuses, nothing removed', { skip: posixOnly }, async () => {
  const t = fresh(); setup(t);
  assert.equal((await un(t, '--apply')).code, 0);
  const elsewhere = tmpDir('burhan-un-elsewhere-');
  rmSync(join(elsewhere), { recursive: true, force: true });
  spawnSync('mv', [join(t, '.burhan'), elsewhere]);
  symlinkSync(elsewhere, join(t, '.burhan'));
  const inside = tree(elsewhere);
  const r = await un(t, '--all', '--apply');
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /burhan is not installed/);
  assert.deepEqual(tree(elsewhere), inside, 'nothing removed through the link');

  const none = fresh();
  const n = await un(none, '--all', '--apply');
  assert.notEqual(n.code, 0);
  assert.match(n.err + n.out, /burhan is not installed/);
  assert.doesNotMatch(n.err + n.out, /only your kept files remain/);
});

test('no leftovers state without a kept burhan file: an empty .burhan/, memory only, or .burhan as a file → refuses, nothing removed', async () => {
  for (const make of [
    (t: string) => mkdirSync(join(t, '.burhan')),
    (t: string) => { put(t, '.burhan/PROJECT.md', '# P\n'); put(t, '.burhan/context/stack.md', '# c\n'); },
    (t: string) => writeFileSync(join(t, '.burhan'), 'not a folder\n'),
  ]) {
    const t = fresh(); make(t);
    const before = tree(t);
    const r = await un(t, '--all', '--apply');
    assert.notEqual(r.code, 0);
    assert.match(r.err + r.out, /burhan is not installed/);
    assert.doesNotMatch(r.err + r.out, /only your kept files remain/);
    assert.deepEqual(tree(t), before);
  }
});
