import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitFound, kitInstallCommand, kitMissing, realKitProbe, type KitProbe } from '../../src/hooks/core/kit-command.mjs';
import { posixOnly, tmpDir } from '../helpers.js';

// AC-01, AC-02: one pure answer to "is the kit command found without the network".
const fake = (files: string[], o: Partial<KitProbe> = {}): KitProbe => ({
  isFile: (p) => files.includes(p), isRunnable: (p) => files.includes(p),
  env: { PATH: '/usr/bin:/opt/bin' }, platform: 'linux', ...o,
});

test('found in the project node_modules/.bin, or in an absolute PATH folder', () => {
  assert.equal(kitFound('/proj', fake(['/proj/node_modules/.bin/burhan'])), true);
  assert.equal(kitFound('/proj', fake(['/opt/bin/burhan'])), true);
});

test('not found when neither has it, when PATH is missing, or when the file is not runnable', () => {
  assert.equal(kitFound('/proj', fake([])), false);
  assert.equal(kitFound('/proj', fake(['/proj/node_modules/.bin/other'])), false);
  assert.equal(kitFound('/proj', fake(['/opt/bin/burhan'], { env: {} })), false);
  assert.equal(kitFound('/proj', fake(['/proj/node_modules/.bin/burhan'], { isRunnable: () => false })), false);
});

test('an empty or relative PATH entry is not trusted: a burhan in the current folder is not the kit', () => {
  const p = fake(['bin/burhan', 'burhan', './burhan'], { env: { PATH: ':bin:.:' } });
  assert.equal(kitFound('/proj', p), false);
});

test('Windows: burhan.cmd or burhan.exe, a ; PATH, the Path spelling; the sh shim alone is not enough', () => {
  const win = (files: string[], env: Record<string, string>): KitProbe => fake(files, { platform: 'win32', env });
  assert.equal(kitFound('C:\\proj', win(['C:\\proj\\node_modules\\.bin\\burhan.cmd'], {})), true);
  assert.equal(kitFound('C:\\proj', win(['C:\\proj\\node_modules\\.bin\\burhan'], {})), false);
  assert.equal(kitFound('C:\\proj', win(['D:\\npm\\burhan.cmd'], { Path: 'C:\\Tools;D:\\npm' })), true);
  assert.equal(kitFound('C:\\proj', win(['D:\\npm\\burhan.exe'], { PATH: 'C:\\Tools;npm' })), false);
});

test('kitInstallCommand and kitMissing', () => {
  assert.equal(kitInstallCommand(true, '0.9.0'), 'npm i -D burhan-kit@0.9.0');
  assert.equal(kitInstallCommand(true, null), 'npm i -D burhan-kit');
  assert.equal(kitInstallCommand(false, '0.9.0'), 'npm i -g burhan-kit');
  assert.equal(kitMissing('/proj', fake(['/proj/node_modules/.bin/burhan']), '1.2.3'), null);
  assert.equal(kitMissing('/proj', fake(['/proj/package.json']), '1.2.3'), 'npm i -D burhan-kit@1.2.3');
  assert.equal(kitMissing('/proj', fake([]), '1.2.3'), 'npm i -g burhan-kit');
});

test('the real probe: an executable file in node_modules/.bin counts, one with no execute bit does not', { skip: posixOnly }, () => {
  const p = tmpDir('burhan-kitreal-');
  const bin = join(p, 'node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'burhan'), '#!/bin/sh\n');
  chmodSync(join(bin, 'burhan'), 0o644);
  const probe = realKitProbe({ PATH: '' }, process.platform);
  assert.equal(kitFound(p, probe), false);
  chmodSync(join(bin, 'burhan'), 0o755);
  assert.equal(kitFound(p, probe), true);
});
