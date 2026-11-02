import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProject } from '../src/lib/find-project.js';
import { tmpDir } from './helpers.js';

test('findProject: the nearest folder with .burhan/WORKFLOW.md, a .burhan/ without it is not an install, none is null', () => {
  const outer = tmpDir('burhan-find-');
  mkdirSync(join(outer, '.burhan')); writeFileSync(join(outer, '.burhan', 'WORKFLOW.md'), '#\n');
  const inner = join(outer, 'packages', 'inner'); mkdirSync(join(inner, '.burhan'), { recursive: true }); writeFileSync(join(inner, '.burhan', 'WORKFLOW.md'), '#\n');
  const deep = join(inner, 'src', 'a'); mkdirSync(deep, { recursive: true });
  assert.equal(findProject(deep), inner); // the nearest install wins
  assert.equal(findProject(inner), inner);
  const stray = join(outer, 'tools', 'x'); mkdirSync(join(stray, '.burhan', 'work'), { recursive: true });
  assert.equal(findProject(stray), outer); // a stray .burhan/ (no WORKFLOW.md) is passed over
  const none = tmpDir('burhan-find-none-');
  assert.equal(findProject(none), null);
});
