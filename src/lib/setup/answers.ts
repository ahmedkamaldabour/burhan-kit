import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS } from '../install.js';
import type { Agent } from '../bootstrap.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { agentInstalled } from '../hooks-merge.js';

export type DocsChoice = { kind: 'private' } | { kind: 'shared' } | { kind: 'custom'; path: string };
/** Where side findings go: `beside` = a `discovery` folder next to the work files if one exists, else today's default; or a folder the person names. */
export type DiscoveryChoice = { kind: 'beside' } | { kind: 'custom'; path: string };
export interface SetupAnswers {
  agents: Agent[]; mode: 'step' | 'auto'; docs: DocsChoice; discovery?: DiscoveryChoice; lang: 'en' | 'ar'; reviewer?: 'other' | 'same' | 'claude' | 'codex';
}

/** Where work files go for each choice. Private is invisible to git (R-5); shared keeps the example defaults. */
export const PRIVATE_DOCS = '.burhan/work';
export const PRIVATE_DISCOVERY = '.burhan/discovery';
export const SHARED_DOCS = 'docs/burhan/work';
export const SHARED_DISCOVERY = 'docs/burhan/discovery';

/** Fresh projects use the agents already present (else claude), pause after each part, and share task artifacts with the team. */
export function recommended(target: string, _home: string): SetupAnswers {
  const found = AGENTS.filter((a) => existsSync(join(target, `.${a}`)));
  return { agents: found.length ? [...found] : ['claude'], mode: 'step', docs: { kind: 'shared' }, lang: 'en', ...(found.length > 1 ? { reviewer: 'other' as const } : {}) };
}

/** AC-17: the answers an existing install already stands for (the team config is the truth); null when burhan is not installed. */
export function currentAnswers(target: string): SetupAnswers | null {
  if (!existsSync(join(target, '.burhan/WORKFLOW.md'))) return null;
  const agents = AGENTS.filter((a) => agentInstalled(target, a));
  const team = existsSync(join(target, TEAM_CONFIG)) ? parseConfig(readFileSync(join(target, TEAM_CONFIG), 'utf8')).values : {};
  const docsDir = (team.WF_DOCS_DIR || PRIVATE_DOCS).replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const docs: DocsChoice = docsDir === PRIVATE_DOCS ? { kind: 'private' } : docsDir === SHARED_DOCS ? { kind: 'shared' } : { kind: 'custom', path: docsDir };
  const reviewer = team.WF_REVIEWER_AGENT;
  const savedReviewer = reviewer === 'other' || reviewer === 'same' || reviewer === 'claude' || reviewer === 'codex' ? reviewer : 'same';
  return { agents: agents.length ? [...agents] : ['claude'], mode: team.WF_MODE_DEFAULT === 'auto' ? 'auto' : 'step', docs, lang: 'en', ...(agents.length > 1 ? { reviewer: savedReviewer } : {}) };
}
