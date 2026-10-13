import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHookConfig } from '../../src/hooks/core/config.mjs';
import { parseConfig as cliParse } from '../../src/lib/config.js';
import { parseConfig as hookParse } from '../../src/hooks/core/config.mjs';
import { tmpDir } from '../helpers.js';

function proj(team: string[] | null, local: string[] | null = null): string {
  const p = tmpDir('burhan-hcfg-');
  mkdirSync(join(p, '.workflow/local'), { recursive: true });
  if (team) writeFileSync(join(p, '.workflow/workflow.config'), team.join('\n') + '\n');
  if (local) writeFileSync(join(p, '.workflow/local/workflow.config'), local.join('\n') + '\n');
  return p;
}

test('the CLI and the hooks share one parser', () => {
  assert.equal(cliParse, hookParse);
});
test('defaults (wf_init), also for empty values', () => {
  const c = loadHookConfig(proj(['WF_DOCS_DIR=""', 'WF_SKILLS=']), {});
  assert.equal(c.WF_DOCS_DIR, 'AI_SPEC/docs');
  assert.equal(c.WF_DISCOVERY_DIR, 'AI_SPEC/discovery');
  assert.equal(c.WF_STATE_FILE, '.workflow/local/PROGRESS.md');
  assert.equal(c.WF_STATE_BUDGET, '80');
  assert.equal(c.WF_CHECK_TIMEOUT, '60');
  assert.equal(c.WF_SKILLS, 'none');
});
test('missing config -> defaults', () => {
  assert.equal(loadHookConfig(proj(null), {}).WF_DOCS_DIR, 'AI_SPEC/docs');
});
test('paths lose leading ./ and a trailing /', () => {
  const c = loadHookConfig(proj(['WF_DOCS_DIR="././docs/"', 'WF_STATE_FILE=./s/NOW.md']), {});
  assert.equal(c.WF_DOCS_DIR, 'docs');
  assert.equal(c.WF_STATE_FILE, 's/NOW.md');
});
test('non-numeric timeout and budget fall back', () => {
  const c = loadHookConfig(proj(['WF_CHECK_TIMEOUT=60s5', 'WF_STATE_BUDGET=lots']), {});
  assert.equal(c.WF_CHECK_TIMEOUT, '60');
  assert.equal(c.WF_STATE_BUDGET, '80');
});
test('layering: environment < team < local', () => {
  const p = proj(['WF_CHECK_CMD="team"', 'WF_CODE_REGEX=team'], ['WF_CHECK_CMD="mine"']);
  const c = loadHookConfig(p, { WF_CHECK_CMD: 'env', WF_CODE_REGEX: 'env', WF_TEST_REGEX: 'env', HOME: '/h' });
  assert.equal(c.WF_CHECK_CMD, 'mine');
  assert.equal(c.WF_CODE_REGEX, 'team');
  assert.equal(c.WF_TEST_REGEX, 'env');
  assert.equal(c.HOME, undefined);
});
test('the local WF_CHECK_TIMEOUT is ignored; the team one (or the default) stays', () => {
  assert.equal(loadHookConfig(proj(['WF_CHECK_TIMEOUT=90'], ['WF_CHECK_TIMEOUT=300']), {}).WF_CHECK_TIMEOUT, '90');
  assert.equal(loadHookConfig(proj([], ['WF_CHECK_TIMEOUT=300']), {}).WF_CHECK_TIMEOUT, '60');
});
test('WF_CONFIG (environment) replaces the team file and switches the local layer off', () => {
  const p = proj(['WF_CHECK_CMD="team"'], ['WF_CHECK_CMD="mine"']);
  const alt = join(p, 'alt.config'); writeFileSync(alt, 'WF_CHECK_CMD="alt"\n');
  assert.equal(loadHookConfig(p, { WF_CONFIG: alt }).WF_CHECK_CMD, 'alt');
});
test('a WF_CONFIG line inside the team file does not switch the local layer off', () => {
  const p = proj(['WF_CONFIG=/nonexistent'], ['WF_CHECK_CMD="mine"']);
  assert.equal(loadHookConfig(p, {}).WF_CHECK_CMD, 'mine');
});
test('a non-literal line is ignored (D2)', () => {
  const c = loadHookConfig(proj(['WF_CHECK_CMD="$HOME/x"', 'WF_CODE_REGEX=ok']), {});
  assert.equal(c.WF_CHECK_CMD ?? '', '');
  assert.equal(c.WF_CODE_REGEX, 'ok');
});
