import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { install } from '../src/lib/install.js';
import { BurhanError } from '../src/lib/errors.js';
import { capture, notOnWindows, tmpDir } from './helpers.js';

const skip = notOnWindows('symlinks need privileges on Windows');
const OUTSIDE_JSON = '{"theme":"dark"}\n';

interface Scene { project: string; real: string; outside: string }
/** A project whose `.claude/settings.json` leads to a file outside (`how`), or inside it. */
function scene(how: 'file' | 'folder' | 'dangling' | 'inside' | 'none' | 'sibling' | 'dotdot' | 'absentdotdot' | 'loop', file = '.claude/settings.json'): Scene {
  const project = tmpDir('burhan-out-p-');
  const away = tmpDir('burhan-out-away-');
  const outside = join(away, 'settings.json');
  const dir = file.split('/')[0];
  if (how === 'file') { mkdirSync(join(project, dir)); writeFileSync(outside, OUTSIDE_JSON); symlinkSync(outside, join(project, file)); }
  else if (how === 'folder') { writeFileSync(outside, OUTSIDE_JSON); symlinkSync(away, join(project, dir)); }
  else if (how === 'dangling') { mkdirSync(join(project, dir)); symlinkSync(outside, join(project, file)); }
  else if (how === 'inside') { mkdirSync(join(project, dir)); writeFileSync(join(project, 'shared.json'), OUTSIDE_JSON); symlinkSync(join(project, 'shared.json'), join(project, file)); }
  else if (how === 'sibling') { // /…/p-evil next to /…/p: a prefix test without the separator would call it inside
    const evil = project + '-evil'; mkdirSync(evil); writeFileSync(join(evil, 'settings.json'), OUTSIDE_JSON);
    mkdirSync(join(project, dir)); symlinkSync(join(evil, 'settings.json'), join(project, file));
    return { project, real: realpathSync(project), outside: join(evil, 'settings.json') };
  } else if (how === 'dotdot') { // review I-1: `..` after a folder link is taken in the link's target
    mkdirSync(join(away, 'deep')); writeFileSync(outside, OUTSIDE_JSON); writeFileSync(join(project, 'x.json'), OUTSIDE_JSON);
    symlinkSync(join(away, 'deep'), join(project, 'evil')); mkdirSync(join(project, dir));
    symlinkSync('../evil/../settings.json', join(project, file));
  } else if (how === 'absentdotdot') { // review C-1: `..` after a part that does not exist, then a folder link
    mkdirSync(join(project, dir)); mkdirSync(join(away, 'deep'));
    symlinkSync(away, join(project, dir, 'evil')); symlinkSync('absent/../evil/settings.json', join(project, file));
  } else if (how === 'loop') { mkdirSync(join(project, dir)); symlinkSync('loop-b', join(project, dir, 'loop-a')); symlinkSync('loop-a', join(project, dir, 'loop-b')); symlinkSync('loop-a', join(project, file)); }
  return { project, real: realpathSync(project), outside };
}
const run = (s: Scene, o: { apply: boolean; mode?: 'init' | 'upgrade'; allow?: boolean; agents?: ('claude' | 'codex')[] }) => {
  const c = capture(s.project);
  let code = -1; let error: unknown;
  try {
    code = install({ mode: o.mode ?? 'init', target: s.project, agents: o.agents ?? ['claude'], apply: o.apply, bootstrap: false, allowOutsideSettings: o.allow }, c.io);
  } catch (e) { error = e; }
  return { ...c.o, code, error };
};
const hooksIn = (f: string): number => Object.keys((JSON.parse(readFileSync(f, 'utf8')) as { hooks?: object }).hooks ?? {}).length;

for (const how of ['file', 'folder', 'dangling', 'sibling', 'dotdot'] as const) {
  test(`dry run names the outside target (${how} link) and says --apply would refuse; exit 1; nothing written`, { skip }, () => {
    const s = scene(how);
    const r = run(s, { apply: false });
    assert.equal(r.code, 1);
    assert.match(r.out, /outside the project/u);
    assert.ok(r.out.includes(s.outside) || r.out.includes(realpathSync(join(s.outside, '..')) + '/settings.json'), r.out);
    assert.match(r.out, /--allow-outside-settings/u);
    assert.equal(existsSync(join(s.project, '.burhan')), false);
  });

  test(`--apply refuses an outside ${how} link before any write: nothing created, the outside file untouched`, { skip }, () => {
    const s = scene(how);
    const r = run(s, { apply: true });
    assert.ok(r.error instanceof BurhanError, 'expected a refusal');
    assert.match((r.error as Error).message, /outside the project/u);
    assert.match((r.error as Error).message, /nothing was changed/u);
    assert.match((r.error as Error).message, /--allow-outside-settings/u);
    assert.equal(existsSync(join(s.project, '.burhan')), false);
    if (how !== 'dangling') assert.equal(readFileSync(s.outside, 'utf8'), OUTSIDE_JSON);
    else assert.equal(existsSync(s.outside), false);
  });

  test(`--apply --allow-outside-settings writes the outside ${how} target and prints its path`, { skip }, () => {
    const s = scene(how);
    const r = run(s, { apply: true, allow: true });
    assert.equal(r.error, undefined);
    assert.equal(r.code, 0);
    assert.match(r.out, /outside the project/u);
    assert.equal(hooksIn(s.outside), 5);
  });
}

test('upgrade refuses the same way, and the flag lifts it', { skip }, () => {
  const s = scene('none');
  assert.equal(run(s, { apply: true }).code, 0); // a normal install first
  const settings = join(s.project, '.claude/settings.json');
  const moved = join(tmpDir('burhan-out-away-'), 'settings.json');
  writeFileSync(moved, readFileSync(settings, 'utf8'));
  rmSync(settings);
  symlinkSync(moved, settings);
  assert.ok(run(s, { apply: true, mode: 'upgrade' }).error instanceof BurhanError);
  assert.equal(run(s, { apply: false, mode: 'upgrade' }).code, 1);
  assert.equal(run(s, { apply: true, mode: 'upgrade', allow: true }).code, 0);
});

test('the Codex hooks file is guarded too', { skip }, () => {
  const s = scene('file', '.codex/hooks.json');
  const r = run(s, { apply: true, agents: ['codex'] });
  assert.ok(r.error instanceof BurhanError);
  assert.match((r.error as Error).message, /\.codex\/hooks\.json/u);
  assert.equal(readFileSync(s.outside, 'utf8'), OUTSIDE_JSON);
});

test('a link that stays inside the project is not refused: link kept, target written, nothing about "outside"', { skip }, () => {
  const s = scene('inside');
  const r = run(s, { apply: true });
  assert.equal(r.error, undefined);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /outside the project/u);
  assert.ok(lstatSync(join(s.project, '.claude/settings.json')).isSymbolicLink());
  assert.equal(hooksIn(join(s.project, 'shared.json')), 5);
});

test('no link: output has no outside line and the flag changes nothing', () => {
  const a = run(scene('none'), { apply: false });
  assert.doesNotMatch(a.out, /outside/u);
  assert.equal(a.code, 0);
});

test('`..` after a missing part is refused, not guessed (nothing is written anywhere)', { skip }, () => {
  const s = scene('absentdotdot');
  assert.ok(run(s, { apply: true }).error instanceof BurhanError);
  assert.equal(existsSync(s.outside), false);
  assert.equal(existsSync(join(s.project, '.burhan')), false);
});

test('a link loop is refused as outside (a write through it could not be placed)', { skip }, () => {
  const s = scene('loop');
  assert.ok(run(s, { apply: true }).error instanceof BurhanError);
  assert.equal(existsSync(join(s.project, '.burhan')), false);
});
