import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { projectKey } from '../../src/lib/evidence.js';
import { run } from '../../src/hooks/main.mjs';

test('session_start stores the Now slugs and state fingerprint outside the project', async () => {
  const project = tmpDir('burhan-session-store-project-');
  const root = tmpDir('burhan-session-store-evidence-');
  const stateFile = '.burhan/local/PROGRESS.md';
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, stateFile), '## Now\n### alpha\n- first\n### beta\n- second\n');

  const result = await run(
    ['core', 'session-gates'],
    JSON.stringify({ event: 'session_start', project_dir: project, session: 'S1' }),
    { ...process.env, WF_EVIDENCE_DIR: root },
  );

  assert.equal(result.debug, '');
  const session = join(root, projectKey(project), 'S1');
  assert.equal(existsSync(join(session, 'now-slugs')), false, 'the Now list is taken before a write, not at the start (multi-session-safety)');
  assert.match(readFileSync(join(session, 'state-fingerprint'), 'utf8'), /^file:[0-9a-f]{64}\n$/);
});
