import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });

/** A repository with one commit, an item foo whose story names `sha` (or the given text), and a second commit that holds only the item's own docs. */
function repo(verified?: string): { p: string; sha: string } {
  const p = tmpDir('burhan-chw-');
  git(p, 'init', '-q');
  mkdirSync(join(p, 'src'), { recursive: true });
  writeFileSync(join(p, 'src/a.js'), 'a\n');
  git(p, 'add', '-A'); git(p, 'commit', '-qm', 'base');
  const sha = git(p, 'rev-parse', '--short', 'HEAD').stdout.trim();
  mkdirSync(join(p, '.burhan/work/foo'), { recursive: true });
  writeFileSync(join(p, '.burhan/work/foo/foo-story.md'), `## Codebase verification\n- **Verified at commit:** ${verified ?? sha}\n`);
  git(p, 'add', '-A'); git(p, 'commit', '-qm', 'docs');
  return { p, sha };
}

test('no file changed: says what it compared and that it cannot judge the facts', async () => {
  const { p, sha } = repo();
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo'], io), 0);
  assert.match(o.out, new RegExp(`no change since ${sha}`));
  assert.match(o.out, /compares files only/);
  assert.match(o.out, /cannot tell whether the story's facts were right when they were written/);
  assert.doesNotMatch(o.out, /still hold/);
});

test('the json output keeps its shape', async () => {
  const { p, sha } = repo();
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo', '--json'], io), 0);
  assert.deepEqual(JSON.parse(o.out), { item: 'foo', sha, files: [] });
});

test('without a sha it still says to re-check every fact', async () => {
  const { p } = repo('<sha>');
  const { o, io } = capture();
  assert.equal(await runCli(['changed', p, '--item', 'foo'], io), 0);
  assert.match(o.out, /re-check every fact/);
});
