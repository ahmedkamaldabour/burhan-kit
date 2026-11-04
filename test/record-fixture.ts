import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectKey } from '../src/lib/evidence.js';
import { tmpDir } from './helpers.js';
import { cli, projectWithItem } from './item-fixture.js';

export const NODE = process.execPath;

/** A git project with item foo (made by `burhan item new`), code = *.ts and a full run = a command that sets process.exitCode. The evidence store is an empty folder of this test, so there is no
 *  hook ledger until `ledgerFor` writes one. The caller restores XDG_STATE_HOME and WF_EVIDENCE_DIR afterwards. */
export async function recordProject(full = 'process[.]exitCode', extra = ''): Promise<string> {
  const dir = await projectWithItem();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, '.burhan', 'workflow.config'), `WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='${full}'\n${extra}`);
  process.env.XDG_STATE_HOME = tmpDir('burhan-noledger-');
  process.env.WF_EVIDENCE_DIR = '';
  return dir;
}

/** `burhan verify foo -- node -e process.exitCode=<code>`: a real record of item foo (the code state is taken now). */
export const verifyRun = (dir: string, code: number) => cli(dir, ['verify', 'foo', '--', NODE, '-e', `process.exitCode=${code}`]);

/** Steps in the hook ledger of `dir`, for item foo, written the way the turn-audit hook writes them. */
export function ledgerFor(dir: string, recs: object[]): void {
  const folder = join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(dir), 'S1');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'T1.jsonl'), recs.map((r, i) => JSON.stringify({ agent: 'claude', session: 'S1', turn: 'T1', seq: i + 1, item: 'foo', project: dir, ...r })).join('\n') + '\n');
}
