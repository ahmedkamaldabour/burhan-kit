import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS } from '../install.js';
import type { Agent } from '../bootstrap.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';

export type DocsChoice = { kind: 'private' } | { kind: 'shared' } | { kind: 'custom'; path: string };
export interface SetupAnswers { agents: Agent[]; mode: 'step' | 'auto'; docs: DocsChoice; lang: 'en' | 'ar' }

/** Where work files go for each choice. Private is invisible to git (R-5); shared keeps the example defaults. */
export const PRIVATE_DOCS = '.burhan/work';
export const PRIVATE_DISCOVERY = '.burhan/discovery';
export const SHARED_DOCS = 'AI_SPEC/docs';
export const SHARED_DISCOVERY = 'AI_SPEC/discovery';

/** The cautious defaults: the agents already used in this project (else claude), pause after each part, private work files. */
export function recommended(target: string, _home: string): SetupAnswers {
  const found = AGENTS.filter((a) => existsSync(join(target, `.${a}`)));
  return { agents: found.length ? [...found] : ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' };
}

/** AC-17: the answers an existing install already stands for (the team config is the truth); null when burhan is not installed. */
export function currentAnswers(target: string): SetupAnswers | null {
  if (!existsSync(join(target, '.workflow/WORKFLOW.md'))) return null;
  const agents = AGENTS.filter((a) => existsSync(join(target, '.workflow/hooks/adapters', a)));
  const team = existsSync(join(target, TEAM_CONFIG)) ? parseConfig(readFileSync(join(target, TEAM_CONFIG), 'utf8')).values : {};
  const docsDir = (team.WF_DOCS_DIR ?? '').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const docs: DocsChoice = docsDir === '' || docsDir === PRIVATE_DOCS ? { kind: 'private' } : docsDir === SHARED_DOCS ? { kind: 'shared' } : { kind: 'custom', path: docsDir };
  return { agents: agents.length ? [...agents] : ['claude'], mode: team.WF_MODE_DEFAULT === 'auto' ? 'auto' : 'step', docs, lang: 'en' };
}
