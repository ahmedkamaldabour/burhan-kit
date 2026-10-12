import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/main.js';
import { capture } from './helpers.js';

const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });

function repo(storyLine: (sha: string) => string): { p: string; sha: string } {
  const p = mkdtempSync(join(tmpdir(), 'burhan-ch-'));
  git(p, 'init', '-q');
  mkdirSync(join(p, 'src'), { recursive: true });
  writeFileSync(join(p, 'src/a.js'), 'a\n'); writeFileSync(join(p, 'src/b.js'), 'b\n');
  git(p, 'add', '-A'); git(p, 'commit', '-qm', 'base');
  const sha = git(p, 'rev-parse', '--short', 'HEAD').stdout.trim();
  mkdirSync(join(p, 'AI_SPEC/docs/foo'), { recursive: true });
  writeFileSync(join(p, 'AI_SPEC/docs/foo/foo-story.md'), `## Codebase verification\n${storyLine(sha)}\n`);
  return { p, sha };
}

test('lists files changed since the verified commit: committed, uncommitted and new', async () => {
  const { p, sha } = repo((s) => `- **Verified at commit:** \`${s}\` (2026-10-11)`);
  writeFileSync(join(p, 'src/a.js'), 'a2\n'); git(p, 'commit', '-qam', 'change a');
  writeFileSync(join(p, 'src/b.js'), 'b2\n');            // uncommitted
  writeFileSync(join(p, 'src/c.js'), 'c\n');             // new, untracked
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo'], io), 0);
  assert.match(o.out, new RegExp(`changed since ${sha}`));
  for (const f of ['src/a.js', 'src/b.js', 'src/c.js']) assert.match(o.out, new RegExp(f.replace('.', '\\.')));
  assert.doesNotMatch(o.out, /AI_SPEC\/docs/, 'the item\'s own docs are not code facts');
});

test('no change since the commit -> says so', async () => {
  const { p, sha } = repo((s) => `- **Verified at commit:** ${s}`);
  git(p, 'add', '-A'); git(p, 'commit', '-qm', 'docs');
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo'], io), 0);
  assert.match(o.out, new RegExp(`no change since ${sha}`));
});

test('missing or unknown commit -> asks for a full re-check, never guesses', async () => {
  const a = repo(() => '- **Verified at commit:** <sha>');
  const x = capture();
  assert.equal(await runCli(['changed', a.p, '--item', 'foo'], x.io), 0);
  assert.match(x.o.out, /re-check every fact/);
  const b = repo(() => '- **Verified at commit:** deadbeef1');
  const y = capture();
  assert.equal(await runCli(['changed', b.p, '--item', 'foo'], y.io), 0);
  assert.match(y.o.out, /not a commit in this repository/);
  const z = capture();
  assert.equal(await runCli(['changed', b.p], z.io), 2, '--item is required');
});

test('a target below the repository root: paths relative to it, nothing outside it, own docs excluded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'burhan-ch-mono-'));
  git(root, 'init', '-q');
  mkdirSync(join(root, 'app/src'), { recursive: true }); mkdirSync(join(root, 'other'), { recursive: true });
  writeFileSync(join(root, 'app/src/a.js'), 'a\n'); writeFileSync(join(root, 'other/o.js'), 'o\n');
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  const sha = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim();
  mkdirSync(join(root, 'app/AI_SPEC/docs/foo'), { recursive: true });
  writeFileSync(join(root, 'app/AI_SPEC/docs/foo/foo-story.md'), `- **Verified at commit:** ${sha}\n`);
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'story');
  writeFileSync(join(root, 'app/src/a.js'), 'a2\n'); writeFileSync(join(root, 'other/o.js'), 'o2\n');
  writeFileSync(join(root, 'app/src/مثال.js'), 'x\n');
  const { o, io } = capture();
  assert.equal(await runCli(['changed', join(root, 'app'), '--item', 'foo', '--json'], io), 0);
  assert.deepEqual(JSON.parse(o.out).files, ['src/a.js', 'src/مثال.js'], 'relative to the target, unquoted, own docs and other/ excluded');
});

test('--item must be a slug; a non-repository says so', async () => {
  const { p, sha } = repo((s) => `- **Verified at commit:** ${s}`);
  const a = capture();
  assert.equal(await runCli(['changed', p, '--item', '../../etc'], a.io), 2);
  assert.match(a.o.err, /not a work-item slug/);
  const plain = mkdtempSync(join(tmpdir(), 'burhan-ch-norepo-'));
  mkdirSync(join(plain, 'AI_SPEC/docs/foo'), { recursive: true });
  writeFileSync(join(plain, 'AI_SPEC/docs/foo/foo-story.md'), `- **Verified at commit:** ${sha}\n`);
  const b = capture();
  assert.equal(await runCli(['changed', plain, '--item', 'foo'], b.io), 0);
  assert.match(b.o.out, /not a git repository/);
});

test('a renamed file lists both its old and new path', async () => {
  const { p, sha } = repo((s) => `- **Verified at commit:** ${s}`);
  git(p, 'mv', 'src/a.js', 'src/z.js'); git(p, 'commit', '-qm', 'rename');
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo', '--json'], io), 0);
  assert.deepEqual(JSON.parse(o.out).files, ['src/a.js', 'src/z.js'], sha);
});

test('a tag named like the short sha does not shadow the commit', async () => {
  const { p, sha } = repo((s) => `- **Verified at commit:** \`${s}\``);
  writeFileSync(join(p, 'src/a.js'), 'a2\n'); git(p, 'commit', '-qam', 'change a');
  git(p, 'tag', sha); // points at the newer commit
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo', '--json'], io), 0);
  assert.deepEqual((JSON.parse(o.out) as { files: string[] }).files, ['src/a.js']);
});
