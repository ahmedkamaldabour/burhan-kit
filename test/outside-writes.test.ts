import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { install, planInstall, type OutsideFile } from '../src/lib/install.js';
import { readFileSync } from 'node:fs';
import { capture, symlinkSkip, tmpDir } from './helpers.js';

const skip = symlinkSkip;

// outside-writes-guard SU1: the plan lists EVERY write that would land outside the project, not only the hooks files (AC-01, AC-05).
interface Scene { project: string; away: string }
const scene = (): Scene => ({ project: tmpDir('burhan-owg-p-'), away: tmpDir('burhan-owg-away-') });
const outside = (s: Scene): OutsideFile[] => planInstall({ mode: 'init', target: s.project, agents: ['claude'], apply: false, bootstrap: true }).outside;
const rels = (list: OutsideFile[]): string[] => list.map((f) => f.rel);

test('CLAUDE.md that is a link to a file outside the project is listed', { skip }, () => {
  const s = scene();
  writeFileSync(join(s.away, 'CLAUDE.md'), 'mine\n');
  symlinkSync(join(s.away, 'CLAUDE.md'), join(s.project, 'CLAUDE.md'));
  const list = outside(s);
  assert.deepEqual(rels(list), ['CLAUDE.md']);
  assert.equal(list[0]!.real, join(realpathSync(s.away), 'CLAUDE.md'));
});

test('a managed commands folder that is a link to a folder outside is listed', { skip }, () => {
  const s = scene();
  mkdirSync(join(s.project, '.claude'));
  symlinkSync(s.away, join(s.project, '.claude/commands'));
  const list = rels(outside(s));
  assert.ok(list.some((rel) => rel.startsWith('.claude/commands/burhan/')), list.join(', '));
});

test('.burhan that is a link to a folder outside is listed, once for the folder (the kit would be copied there)', { skip }, () => {
  const s = scene();
  symlinkSync(s.away, join(s.project, '.burhan'));
  assert.ok(rels(outside(s)).some((rel) => rel.startsWith('.burhan')), rels(outside(s)).join(', '));
});

test('.burhan/.gitignore that is a link to a file outside is listed', { skip }, () => {
  const s = scene();
  mkdirSync(join(s.project, '.burhan'));
  writeFileSync(join(s.away, 'ignore'), '');
  symlinkSync(join(s.away, 'ignore'), join(s.project, '.burhan/.gitignore'));
  assert.ok(rels(outside(s)).includes('.burhan/.gitignore'));
});

test('a dangling link to somewhere outside is listed (a write would create its target)', { skip }, () => {
  const s = scene();
  symlinkSync(join(s.away, 'not-there.md'), join(s.project, 'CLAUDE.md'));
  assert.deepEqual(rels(outside(s)), ['CLAUDE.md']);
});

test('a link loop is listed and says so', { skip }, () => {
  const s = scene();
  symlinkSync('b', join(s.project, 'a'));
  symlinkSync('a', join(s.project, 'b'));
  symlinkSync('a', join(s.project, 'CLAUDE.md'));
  const list = outside(s);
  assert.deepEqual(rels(list), ['CLAUDE.md']);
  assert.match(list[0]!.real, /link loop/u);
});

test('a link whose landing is inside the project raises nothing (CLAUDE.md ↔ AGENTS.md)', { skip }, () => {
  const s = scene();
  writeFileSync(join(s.project, 'AGENTS.md'), 'shared\n');
  symlinkSync(join(s.project, 'AGENTS.md'), join(s.project, 'CLAUDE.md'));
  assert.deepEqual(outside(s), []);
});

test('a project with no links raises nothing, and planning writes nothing', { skip }, () => {
  const s = scene();
  assert.deepEqual(outside(s), []);
  assert.throws(() => realpathSync(join(s.project, '.burhan')));
});

test('a link at .burhan/hooks is listed: the Node hooks would be copied through it (review C-1)', { skip }, () => {
  const s = scene();
  mkdirSync(join(s.project, '.burhan'));
  symlinkSync(s.away, join(s.project, '.burhan/hooks'));
  assert.ok(rels(outside(s)).includes('.burhan/hooks'), rels(outside(s)).join(', '));
});

test('the backup copy of an edited managed block is checked too: a link at CLAUDE.md.burhan-backup is listed (review I-1)', { skip }, () => {
  const s = scene();
  install({ mode: 'init', target: s.project, agents: ['claude'], apply: true, bootstrap: true }, capture(s.project).io);
  const file = join(s.project, 'CLAUDE.md');
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('<!-- burhan:start -->');
  writeFileSync(file, text.slice(0, start) + '<!-- burhan:start -->\nedited by hand\n' + text.slice(text.indexOf('<!-- burhan:end -->')));
  writeFileSync(join(s.away, 'precious'), 'keep\n');
  symlinkSync(join(s.away, 'precious'), join(s.project, 'CLAUDE.md.burhan-backup'));
  const list = planInstall({ mode: 'upgrade', target: s.project, agents: ['claude'], apply: false, bootstrap: true }).outside;
  assert.ok(rels(list).includes('CLAUDE.md.burhan-backup'), rels(list).join(', '));
});

test('two project-root files that land outside are listed one by one, never as "./"', { skip }, () => {
  const s = scene();
  writeFileSync(join(s.away, 'c'), ''); writeFileSync(join(s.away, 'a'), '');
  symlinkSync(join(s.away, 'c'), join(s.project, 'CLAUDE.md'));
  symlinkSync(join(s.away, 'a'), join(s.project, 'AGENTS.md'));
  const list = planInstall({ mode: 'init', target: s.project, agents: ['claude', 'codex'], apply: false, bootstrap: true }).outside;
  assert.deepEqual(rels(list).sort(), ['AGENTS.md', 'CLAUDE.md']);
});
