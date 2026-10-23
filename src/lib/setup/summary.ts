import type { Agent } from '../bootstrap.js';
import type { PlannedFile } from '../install.js';
import { lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { parseConfig } from '../config.js';
import { messages, type Messages } from './messages.js';
import { ignoredCommittedSetupFiles, type SetupPlan } from './engine.js';

const AGENT_OF: Record<string, string> = { 'CLAUDE.md': 'claude', 'AGENTS.md': 'codex', '.claude/settings.json': 'claude', '.codex/hooks.json': 'codex' };

function describe(f: PlannedFile, m: Messages): string {
  const created = f.action === 'create';
  if (f.action === 'remove') return m.what.removed;
  switch (f.kind) {
    case 'kit': return m.what.kit(created);
    case 'config': return f.rel.endsWith('bindings.md') ? m.what.bindings(created) : m.what.config(created);
    case 'hooks': return m.what.hooks(created, AGENT_OF[f.rel] ?? 'agent');
    case 'bootstrap': return m.what.bootstrap(created);
    case 'gitignore': return m.what.gitignore;
    case 'state': return m.what.state;
    default: return m.what.managed(created);
  }
}

/** Kit files are listed at directory level; show them as one line, keyed on WORKFLOW.md. */
function collapse(files: PlannedFile[]): PlannedFile[] {
  const out: PlannedFile[] = [];
  let kit: PlannedFile | null = null;
  for (const f of files) {
    if (f.kind !== 'kit') { out.push(f); continue; }
    if (!kit) { kit = { rel: '.burhan/', existed: f.existed, action: f.action, kind: 'kit' }; out.unshift(kit); }
    if (f.rel === '.burhan/WORKFLOW.md') { kit.existed = f.existed; kit.action = f.action; }
  }
  return out;
}

/** AC-21: disclose a settings symlink only when its resolved file escapes the project. */
function outsideSettings(target: string): { rel: string; real: string }[] {
  let root: string;
  try { root = realpathSync(target); } catch { return []; }
  const out: { rel: string; real: string }[] = [];
  for (const rel of ['.claude/settings.json', '.codex/hooks.json']) {
    const file = join(root, rel);
    try {
      if (!lstatSync(file).isSymbolicLink()) continue;
      const real = realpathSync(file);
      if (real !== root && !real.startsWith(root + sep)) out.push({ rel, real });
    } catch { /* absent or dangling links are handled by the normal install validation */ }
  }
  return out;
}

/**
 * The one setup explanation for Superpowers, shared verbatim by summaries and agent instructions. `agents` defaults to
 * the plan's; `setup --agent` passes both, because it runs before the agents are answered.
 */
export function superpowersLine(p: SetupPlan, lang: 'en' | 'ar', agents: readonly Agent[] = p.answers.agents): string {
  return messages(lang).superpowers(p.superpowersAvailable, p.superpowersDisabled, agents);
}

/** AC-06 / AC-03a / AC-05 / AC-18: what will change, the editable defaults, how to change or undo. Prints no setting names. */
export function renderSummary(p: SetupPlan, lang: 'en' | 'ar', superpowersAgents: readonly Agent[] = p.answers.agents): string {
  const m = messages(lang);
  const files = collapse(p.files);
  const out: string[] = [m.title(p.install.target), ''];
  for (const [action, head] of [['create', m.created], ['modify', m.changed], ['remove', m.removed]] as const) {
    const list = files.filter((f) => f.action === action);
    if (action === 'remove' && list.length === 0) continue;
    out.push(head);
    if (list.length === 0) out.push(`  ${m.none}`);
    for (const f of list) out.push(`  ${f.rel} — ${describe(f, m)}`);
    out.push('');
  }
  const cfg = parseConfig(p.config).values;
  const d = p.answers.docs;
  const docsLabel = d.kind === 'private' ? `${cfg.WF_DOCS_DIR}/ (${m.docsPrivate})` : d.kind === 'shared' ? `${cfg.WF_DOCS_DIR}/ (${m.docsShared})` : `${cfg.WF_DOCS_DIR}/ (${m.docsCustom})`;
  out.push(m.settings,
    `  ${m.agents(p.answers.agents)}`,
    `  ${m.mode(p.answers.mode)}`,
    `  ${m.docs(docsLabel)}`,
    `  ${m.discovery(`${cfg.WF_DISCOVERY_DIR}/`)}`,
    ...(p.answers.agents.length > 1 ? [`  ${m.reviewer(p.answers.reviewer ?? 'same')}`] : []),
    `  ${m.models}`,
    `  ${m.branches}`,
    `  ${m.check(cfg.WF_STACK_SETUP === 'pending', cfg.WF_CHECK_CMD || 'none')}`);
  out.push(`  ${superpowersLine(p, lang, superpowersAgents)}`);
  if (p.existingHooks.length) out.push('', ...m.existingHooks(p.existingHooks));
  const ignored = ignoredCommittedSetupFiles(p.install.target, p.files);
  if (ignored.length) out.push('', ...m.ignoredCommittedFiles(ignored));
  const outside = outsideSettings(p.install.target);
  if (outside.length) out.push('', ...m.outsideSettings(outside));
  out.push('', m.changeUndo, m.nothingCommitted);
  if (p.answers.agents.includes('codex')) out.push('', m.codexTrust);
  out.push('', m.newAgentSession(p.install.target));
  return out.join('\n') + '\n';
}
