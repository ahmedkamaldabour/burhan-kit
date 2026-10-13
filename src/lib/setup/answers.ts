import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS } from '../install.js';
import type { Agent } from '../bootstrap.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';

export type DocsChoice = { kind: 'private' } | { kind: 'shared' } | { kind: 'custom'; path: string };
export type ExistingHooksChoice = 'keep' | 'remove-mine';
export type MoveDocsChoice = 'keep' | 'move';
export interface SetupAnswers {
  agents: Agent[]; mode: 'step' | 'auto'; docs: DocsChoice; lang: 'en' | 'ar'; existingHooks?: ExistingHooksChoice;
  /** An existing shared install has the old AI_SPEC layout. */
  legacyShared?: true;
  /** Legacy installs keep their folders unless the person explicitly moves them. */
  moveDocs?: MoveDocsChoice;
}

/** Where work files go for each choice. Private is invisible to git (R-5); shared keeps the example defaults. */
export const PRIVATE_DOCS = '.burhan/work';
export const PRIVATE_DISCOVERY = '.burhan/discovery';
export const SHARED_DOCS = 'docs/burhan/work';
export const SHARED_DISCOVERY = 'docs/burhan/discovery';
export const LEGACY_SHARED_DOCS = 'AI_SPEC/docs';
export const LEGACY_SHARED_DISCOVERY = 'AI_SPEC/discovery';

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
  // Hooks read an unset value as AI_SPEC/docs, so setup must recognise the same effective legacy layout.
  const docsDir = (team.WF_DOCS_DIR || LEGACY_SHARED_DOCS).replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const legacyShared = docsDir === LEGACY_SHARED_DOCS;
  const docs: DocsChoice = docsDir === '' || docsDir === PRIVATE_DOCS ? { kind: 'private' } : docsDir === SHARED_DOCS || legacyShared ? { kind: 'shared' } : { kind: 'custom', path: docsDir };
  return { agents: agents.length ? [...agents] : ['claude'], mode: team.WF_MODE_DEFAULT === 'auto' ? 'auto' : 'step', docs, lang: 'en', ...(legacyShared ? { legacyShared: true as const } : {}) };
}
