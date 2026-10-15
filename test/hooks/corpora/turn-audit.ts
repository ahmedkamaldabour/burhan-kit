import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectKey } from '../../../src/hooks/core/store.mjs';
import { jsonText, maskPath, tmpDir } from '../../helpers.js';
import type { Driver } from '../drivers.js';

type AuditCase = {
  name: string;
  config: string[];
  state: string | null;
  files: Record<string, string>;
  preLink: string | null;
  event: Record<string, unknown>;
  sessionStart?: boolean;
  stateAfter?: string;
  preStore?: Record<string, string>;
  preAge?: Record<string, number>;
  expected?: string;
  linked?: string | null;
};
const corpusPaths = [
  '../../../../test/hooks/fixtures/turn-audit-a-corpus.json',
  '../../../../test/hooks/fixtures/turn-audit-b-corpus.json',
];
const cases = corpusPaths.flatMap((path) => (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { cases: AuditCase[] }).cases);

const replaceProject = <T>(value: T, project: string): T => JSON.parse(JSON.stringify(value).replaceAll('@P', jsonText(project))) as T;

export async function runCorpus(driver: Driver): Promise<void> {
  const failures: string[] = [];
  for (const c of cases) {
    try {
    assert.ok(Object.hasOwn(c, 'expected'), `${c.name}: fixture has no expected output; generate it with the Bash turn-audit hook first`);
    assert.ok(Object.hasOwn(c, 'linked'), `${c.name}: fixture has no linked value; generate it with the Bash turn-audit hook first`);
    const project = tmpDir('burhan-turn-audit-project-');
    const evidence = tmpDir('burhan-turn-audit-evidence-');
    mkdirSync(join(project, '.burhan'), { recursive: true });
    writeFileSync(join(project, '.burhan/workflow.config'), c.config.join('\n') + '\n');
    if (c.state !== null) { mkdirSync(join(project, '.burhan/local'), { recursive: true }); writeFileSync(join(project, '.burhan/local/PROGRESS.md'), c.state); }
    for (const [file, text] of Object.entries(c.files)) {
      const path = join(project, file.replaceAll('@P/', ''));
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text.replaceAll('@P', project));
    }
    const event: Record<string, unknown> = { ...replaceProject(c.event, project), project_dir: project };
    const projectStore = join(evidence, projectKey(project));
    if (c.preLink !== null) {
      const session = String(event.session ?? '');
      const item = join(projectStore, session, 'item');
      mkdirSync(dirname(item), { recursive: true }); writeFileSync(item, `${c.preLink}\n`);
    }
    for (const [relative, text] of Object.entries(c.preStore ?? {})) {
      const path = join(projectStore, relative);
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text.replaceAll('@P', project));
    }
    for (const [relative, secondsAgo] of Object.entries(c.preAge ?? {})) {
      const path = join(projectStore, relative);
      const then = new Date(Date.now() - secondsAgo * 1000);
      utimesSync(path, then, then);
    }
    if (c.sessionStart) {
      await driver(['core', 'session-gates'], JSON.stringify({ event: 'session_start', project_dir: project, session: event.session }), { WF_EVIDENCE_DIR: evidence });
    }
    if (c.stateAfter !== undefined) {
      const statePath = join(project, '.burhan/local/PROGRESS.md');
      mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, c.stateAfter);
    }
    const actual = maskPath(await driver(['core', 'turn-audit'], JSON.stringify(event), { WF_EVIDENCE_DIR: evidence }), project, '@P');
    assert.equal(actual, c.expected, c.name);
    const session = typeof event.session === 'string' ? event.session : '';
    const item = session === '' ? '' : join(evidence, projectKey(project), session, 'item');
    assert.equal(existsSync(item) ? readFileSync(item, 'utf8').trim() : null, c.linked!, `${c.name}: linked item`);
    } catch (e) { failures.push(`${driver.label}: ${c.name}: ${e instanceof Error ? e.message.split('\n').slice(0, 6).join(' | ') : String(e)}`); }
  }
  assert.deepEqual(failures, []);
}
