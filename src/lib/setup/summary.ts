import type { PlannedFile } from '../install.js';
import { parseConfig } from '../config.js';
import { messages, type Messages } from './messages.js';
import type { SetupPlan } from './engine.js';

const AGENT_OF: Record<string, string> = { 'CLAUDE.md': 'claude', 'AGENTS.md': 'codex', '.claude/settings.json': 'claude', '.codex/hooks.json': 'codex' };

function describe(f: PlannedFile, m: Messages): string {
  const created = f.action === 'create';
  if (f.action === 'remove') return m.what.removed;
  if (f.rel === '.burhan/.gitignore') return m.what.privateIgnore;
  switch (f.kind) {
    case 'kit': return m.what.kit(created);
    case 'config': return f.rel.endsWith('bindings.md') ? m.what.bindings(created) : m.what.config(created);
    case 'hooks': return m.what.hooks(created, AGENT_OF[f.rel] ?? 'agent');
    case 'bootstrap': return m.what.bootstrap(created);
    case 'gitignore': return m.what.gitignore;
    default: return m.what.managed(created);
  }
}

/** Kit files are listed at directory level; show them as one line, keyed on WORKFLOW.md. */
function collapse(files: PlannedFile[]): PlannedFile[] {
  const out: PlannedFile[] = [];
  let kit: PlannedFile | null = null;
  for (const f of files) {
    if (f.kind !== 'kit') { out.push(f); continue; }
    if (!kit) { kit = { rel: '.workflow/', existed: f.existed, action: f.action, kind: 'kit' }; out.unshift(kit); }
    if (f.rel === '.workflow/WORKFLOW.md') { kit.existed = f.existed; kit.action = f.action; }
  }
  return out;
}

/** AC-06 / AC-03a / AC-05 / AC-18: what will change, the editable defaults, how to change or undo. Prints no setting names. */
export function renderSummary(p: SetupPlan, lang: 'en' | 'ar'): string {
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
    `  ${m.models}`,
    `  ${m.skills(p.skills)}`,
    `  ${m.branches}`,
    `  ${m.check(cfg.WF_STACK_SETUP === 'pending', cfg.WF_CHECK_CMD || 'none')}`,
    '', m.changeUndo, m.nothingCommitted);
  if (p.answers.agents.includes('codex')) out.push('', m.codexTrust);
  return out.join('\n') + '\n';
}
