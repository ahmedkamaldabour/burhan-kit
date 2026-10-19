import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A file committed from burhan v0.2.2 (test/fixtures/v0.2.2) — a fixed copy, never read from git at test time. */
export const v022 = (name: string): string => readFileSync(new URL(`../../test/fixtures/v0.2.2/${name}`, import.meta.url), 'utf8');

const SNIPPET = {
  claude: { fixture: 'claude.settings.snippet.json', copy: 'settings.snippet.json', agentFile: '.claude/settings.json' },
  codex: { fixture: 'codex.hooks.snippet.json', copy: 'hooks.snippet.json', agentFile: '.codex/hooks.json' },
} as const;

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** A project as burhan 0.2.2 left it: the bash hooks and adapters, the snippet copies, and the bash entries in the agents' hook files.
 *  Hand-built from the committed v0.2.2 snippets, because the current code can no longer produce a bash install. */
export function bashInstall(dir: string, agents: readonly ('claude' | 'codex')[]): void {
  const W = join(dir, '.burhan');
  put(join(W, 'WORKFLOW.md'), '# burhan 0.2.2 working agreement\n');
  put(join(W, 'VERSION'), '0.2.2\n');
  put(join(W, 'hooks/core/lib.sh'), '#!/usr/bin/env bash\n');
  for (const agent of agents) {
    const s = SNIPPET[agent];
    put(join(W, 'hooks/adapters', agent, 'hook.sh'), '#!/usr/bin/env bash\n');
    put(join(W, 'hooks/adapters', agent, s.copy), v022(s.fixture));
    put(join(dir, s.agentFile), v022(s.fixture));
  }
}
