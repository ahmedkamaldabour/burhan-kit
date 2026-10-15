/** Whole-turn audit (ports kit/hooks/core/turn-audit.sh). */
import { evidenceRecord } from './ledger.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ere, ereTest } from './ere.mjs';
import { itemBlock, itemField, itemResolved, itemRoute, itemSlugs, relPath, stateNow, type Check, type Ctx } from './lib.mjs';
import { explicitLink } from './link.mjs';
import { shellWrites } from './shell-writes.mjs';
import { evidenceRoot, fingerprintRefresh, linkedItem, linkItem, mtime, projectKey, safeId, stateSnapshotFile } from './store.mjs';
import { evidenceRuns, lastCodeEdit, lastRunPerCommand, parseSteps, type Step } from './steps.mjs';

const CLAIM = '(^|[^[:alnum:]_])(done|fixed|passing|passes|complete|completed|works now)([^[:alnum:]_]|$)|✅|(^|[[:space:][:punct:]])(خلص|خلصت|اتصلح)([[:space:][:punct:]]|$)';
const PERFORMED = '[^·<>]*[^·<>[:space:]] · [^·<>]*[^·<>[:space:]] · (fresh subagent|other agent|human|same session)';
const negations = [
  /(not|n't|no longer)[\t\n\v\f\r ]+(yet[\t\n\v\f\r ]+)?(fully[\t\n\v\f\r ]+)?(done|fixed|passing|passes|complete|completed)/g,
  /(to be|yet to be|still to be|before it is|until it is)[\t\n\v\f\r ]+(done|fixed|complete|completed)/g,
  /(once|when|after|until|none of) (that|this|it|these|those)( is| are)? (done|fixed|complete|completed)/g,
  /(not quite|almost|nearly) (done|fixed|complete|completed)/g,
  /(is|are) (it|this|that|they) (done|fixed|complete|completed)[?]/g,
  /مش (خلص|خلصت|اتصلح)/g,
];

interface Audit {
  ctx: Ctx;
  written: string[];
  created: string[];
  cmds: string[];
  skillsUsed: string[];
  text: string;
  steps: Step[];
  subWritten: string[];
}
type Gate = (audit: Audit) => string[];

const matches = (pattern: string, text: string): boolean => pattern !== '' && (ere(pattern)?.test(text) ?? false);
const codePointCompare = (left: string, right: string): number => {
  const a = Array.from(left); const b = Array.from(right);
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
};
const completionClaim = (text: string): boolean => {
  let claimText = text.toLowerCase();
  for (const rewrite of negations) claimText = claimText.replace(rewrite, ' ');
  return ere(CLAIM)?.test(claimText) ?? false;
};
const escapeEre = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
const linesIn = (text: string): number => text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
const docsRe = (audit: Audit): string => `^${escapeEre(audit.ctx.cfg.WF_DOCS_DIR ?? '')}/[^/]+/`;
const discoveryRe = (audit: Audit): string => `^${escapeEre(audit.ctx.cfg.WF_DISCOVERY_DIR ?? '')}/[0-9]{4}-[0-9]{2}-[0-9]{2}-[^/]+\\.md$`;
const codeInTurn = (audit: Audit): boolean => {
  const code = audit.ctx.cfg.WF_CODE_REGEX ?? '';
  return matches(code, audit.written.join('\n')) || (code !== '' && lastCodeEdit(audit.steps, ere(code) ?? /$a/) !== null);
};
/** wf_item_now: the slug that applies to this session ('' = none — several blocks and no live link). */
const resolvedSlug = (audit: Audit): string => {
  const now = stateNow(audit.ctx.project, audit.ctx.cfg);
  return itemResolved(now, linkedItem(audit.ctx.project, audit.ctx.ev.get('.session'), itemSlugs(now), audit.ctx.env));
};
/** wf_item_block: the block the field readers see (empty when blocks exist and none applies; the whole Now when there is no block). */
const resolvedItemNow = (audit: Audit): string => {
  const now = stateNow(audit.ctx.project, audit.ctx.cfg);
  return itemBlock(now, resolvedSlug(audit));
};

const gateA: Gate = ({ ctx, written, cmds, text, steps }) => {
  const code = ctx.cfg.WF_CODE_REGEX ?? '';
  const ownCode = matches(code, written.join('\n'));
  const codeEdit = code === '' ? null : lastCodeEdit(steps, ere(code) ?? /$a/);
  if (!(ownCode || codeEdit !== null) || !completionClaim(text)) return [];
  const evidence = ctx.cfg.WF_EVIDENCE_REGEX ?? '';
  if (evidence === '') return ["⚠ VERIFICATION GATE: code changed and completion was claimed, but no evidence pattern configured (WF_EVIDENCE_REGEX), so this turn's verification cannot be checked. Show the command output that proves the claim, or retract it."];
  if (steps.length === 0) return matches(evidence, cmds.join('\n')) ? [] : ["⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification command ran this turn. Run the checks now and show the real output, or explicitly retract the claim."];
  const runs = evidenceRuns(steps, ere(evidence) ?? /$a/);
  if (runs.length === 0) return ["⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification command ran this turn. Run the checks now and show the real output, or explicitly retract the claim."];
  const last = codeEdit ?? { seq: 0, file: '' };
  if (!runs.some((run) => run.seq > last.seq)) {
    const early = runs[runs.length - 1]!;
    return [`⚠ VERIFICATION GATE: completion was claimed, but the evidence (\`${early.cmd}\`) ran before the last code edit (\`${last.file}\`), so it does not prove the final code. Re-run it now and show the output.`];
  }
  const finals = lastRunPerCommand(runs, last.seq);
  const failed = finals.find((run) => run.status === 'failed');
  if (failed) return [`⚠ VERIFICATION GATE: completion was claimed, but the last run of \`${failed.cmd}\` failed${failed.exit === '' ? '' : ` (exit ${failed.exit})`}. Fix it and re-run, then show the passing output — or retract the claim.`];
  const pending = finals.find((run) => run.status === 'blocked' || run.status === 'background');
  if (pending?.status === 'blocked') return [`⚠ VERIFICATION GATE: completion was claimed, but the last run of \`${pending.cmd}\` was blocked and never ran. Run it, show the output — or retract the claim.`];
  if (pending?.status === 'background') return [`⚠ VERIFICATION GATE: completion was claimed, but the last run of \`${pending.cmd}\` was in the background — its result is unknown. Run it in the foreground and show the output.`];
  return [];
};

// ---- B ---------------------------------------------------------------------
const gateB: Gate = (audit) => {
  const state = audit.ctx.cfg.WF_STATE_FILE ?? '';
  // This deliberately refreshes once, even on a turn that did not write a work-item file.
  const changed = fingerprintRefresh(audit.ctx.project, audit.ctx.ev.get('.session'), state, audit.ctx.env);
  const docs = docsRe(audit);
  const workChanged = ereTest(docs, audit.written.join('\n')) || ereTest(docs, audit.subWritten.join('\n'));
  const stateWritten = [...audit.written, ...audit.subWritten].includes(state);
  return workChanged && !stateWritten && !changed
    ? [`⚠ STATE-TRANSITION GATE: a work-item file changed this turn but \`${state}\` was not updated. Write every transition before the turn ends (WORKFLOW §5): edit the existing line in place — no new paragraph, no copied detail (link the file).`]
    : [];
};

// ---- D ---------------------------------------------------------------------
const gateD: Gate = ({ ctx }) => {
  const state = ctx.cfg.WF_STATE_FILE ?? '';
  try {
    const lines = linesIn(readFileSync(join(ctx.project, state), 'utf8'));
    const budget = Number(ctx.cfg.WF_STATE_BUDGET ?? '');
    return Number.isFinite(budget) && lines > budget
      ? [`⚠ STATE-SIZE GATE: \`${state}\` is ${lines} lines (budget: ${budget}). It is a snapshot, not a journal (WORKFLOW §5): close out items no longer in flight, keep one-line pointers, delete resolved lines.`]
      : [];
  } catch { return []; }
};

// ---- E ---------------------------------------------------------------------
const gateE: Gate = (audit) => {
  const stale: string[] = [];
  const eligible = `${docsRe(audit)}|${discoveryRe(audit)}`;
  for (const file of audit.written) {
    try {
      if (file.endsWith('/README.md') || file === 'README.md' || !ereTest(eligible, file)) continue;
      const text = readFileSync(join(audit.ctx.project, file), 'utf8');
      let fenced = false;
      const states = text.split('\n').filter((line) => {
        if (/^[\t\v\f\r ]*```/.test(line)) { fenced = !fenced; return false; }
        return !fenced && !line.includes('→') ? true : !fenced && (line.match(/→/g)?.length ?? 0) < 2;
      }).join('\n');
      const pending = ereTest('(^|[^a-z])status:\**[[:space:]]*\\**[[:space:]]*(draft|planned)\\b', states, { i: true });
      const done = ereTest('✅[[:space:]]*(reviewed|completed)|^#+ .*sub-unit.*✅|(status|verdict):\\**[[:space:]]*\\**[[:space:]]*(completed|resolved|qc pass)\\b', states, { i: true });
      if (pending && done) stale.push(`\`${file}\``);
    } catch { /* a missing/unreadable file is ignored */ }
  }
  return stale.length === 0 ? [] : [`⚠ STALE-STATUS GATE: ${stale.join(', ')} says both pending (status Draft/Planned) and done (✅ Reviewed/Completed, or a Completed/Resolved/QC PASS status). Fix the status line that was never revisited.`];
};

// ---- F ---------------------------------------------------------------------
const gateF: Gate = (audit) => {
  if (audit.ctx.cfg.WF_SKILLS !== 'superpowers') return [];
  const out: string[] = [];
  const docs = docsRe(audit);
  const used = (pattern: string): boolean => ereTest(pattern, audit.skillsUsed.join('\n'));
  if (ereTest(`${docs}.*-story\\.md$`, audit.created.join('\n')) && !used('brainstorming')) out.push('⚠ SKILL GATE (story): a story was CREATED this turn without superpowers:brainstorming. Invoke it now if it was skipped, or say when it ran.');
  if (ereTest(`${docs}.*-implementation-plan\\.md$`, audit.created.join('\n')) && !used('writing-plans')) out.push('⚠ SKILL GATE (plan): a plan was CREATED this turn without superpowers:writing-plans.');
  let patch = ereTest('^[[:space:]>*_-]*patch\\**[[:space:]]*(—|–)', audit.text, { i: true });
  if (patch && resolvedSlug(audit) !== '') patch = ['change / patch', 'bug / patch', 'refactor / patch'].includes(itemRoute(resolvedItemNow(audit)));
  if (patch && (audit.ctx.cfg.WF_SENSITIVE_REGEX ?? '') !== '' && matches(audit.ctx.cfg.WF_SENSITIVE_REGEX ?? '', audit.written.join('\n'))) patch = false;
  if (matches(audit.ctx.cfg.WF_CODE_REGEX ?? '', audit.written.join('\n')) && !patch && !used('test-driven-development|systematic-debugging')) out.push('⚠ SKILL GATE (code): code was written this turn without superpowers:test-driven-development or superpowers:systematic-debugging. Confirm the skill was used, or invoke it before continuing.');
  const reviews = audit.written.filter((file) => ereTest('/reviews/[^/]+\\.md$', file) && !ereTest('-(qc|verification)(-r[0-9]+)?\\.md$', file));
  if (reviews.length > 0 && !used('requesting-code-review')) out.push('⚠ SKILL GATE: a review file was written this turn without superpowers:requesting-code-review.');
  return out;
};

// ---- G ---------------------------------------------------------------------
const gateG: Gate = (audit) => {
  if (!codeInTurn(audit)) return [];
  const item = resolvedItemNow(audit);
  const ro = itemField(item, 'Read-only');
  const route = itemRoute(item);
  const readOnly = route.startsWith('investigation / ') || route === 'bug / spike' ? ro !== 'no' : ro === 'yes';
  return readOnly ? ['🛑 READ-ONLY GATE: the work in flight is marked read-only (investigation / bug + spike) but code was written this turn. Revert it or open a new routed item to implement the finding (WORKFLOW §3).'] : [];
};

// ---- I ---------------------------------------------------------------------
const gateI: Gate = (audit) => {
  const state = audit.ctx.cfg.WF_STATE_FILE ?? '';
  if (!audit.written.includes(state)) return [];
  try {
    const snap = stateSnapshotFile(audit.ctx.project, audit.ctx.ev.get('.session'), audit.ctx.env);
    if (snap === '') return [];
    const root = join(evidenceRoot(audit.ctx.env), projectKey(audit.ctx.project));
    const mine = audit.ctx.ev.get('.session');
    const nowSlugs = new Set(itemSlugs(stateNow(audit.ctx.project, audit.ctx.cfg)));
    const now = Math.floor(Date.now() / 1000);
    for (const removed of readFileSync(snap, 'utf8').split('\n')) {
      if (removed === '' || nowSlugs.has(removed)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === mine || !safeId(entry.name)) continue;
        const dir = join(root, entry.name);
        try {
          if ((readFileSync(join(dir, 'item'), 'utf8').split('\n')[0] ?? '') !== removed) continue;
          for (const ledger of readdirSync(dir)) {
            if (!ledger.endsWith('.jsonl')) continue;
            const then = mtime(join(dir, ledger));
            if (then === null) continue;
            const age = Math.max(0, now - then);
            if (age >= 86400) continue;
            const ago = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`;
            return [`⚠ You removed the \`${removed}\` block — another session (active ${ago}) is working on it. Put it back.`];
          }
        } catch { /* one malformed foreign session cannot hide another */ }
      }
    }
  } catch { /* store failures stay silent */ }
  return [];
};

// ---- H ---------------------------------------------------------------------
const gateH: Gate = (audit) => {
  const qc = `${docsRe(audit)}reviews/[^/]+-qc(-r[0-9]+)?\\.md$`;
  const main = audit.written.filter((file) => ereTest(qc, file));
  const qcs = [...new Set([...main, ...audit.subWritten.filter((file) => ereTest(qc, file))])];
  if (qcs.length === 0) return [];
  const missing: string[] = [];
  let sameSession = false;
  for (const file of qcs) {
    try {
      const line = readFileSync(join(audit.ctx.project, file), 'utf8').split('\n').find((text) => ereTest('\\*\\*Performed by:\\*\\*', text)) ?? '';
      const by = line.replace(/^.*\*\*Performed by:\*\*[\t\n\v\f\r ]*/, '').replace(/[\*\r]/g, '').replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
      if (!ereTest(PERFORMED, by) || !ereTest(`^${PERFORMED}$`, by)) missing.push(`\`${file}\``);
      if (main.includes(file) && ereTest(' · same session[[:space:]]*$', by)) sameSession = true;
    } catch { /* Bash skips missing QC files */ }
  }
  const out: string[] = [];
  if (missing.length > 0) out.push(`⚠ QC PROVENANCE: ${missing.join(', ')} does not say who performed the QC. Fill **Performed by** (agent · model · context: fresh subagent / other agent / human / same session); same session must also be listed under Limitations (WORKFLOW §2 · 8).`);
  if (matches(audit.ctx.cfg.WF_CODE_REGEX ?? '', audit.written.join('\n')) && main.length > 0 && !sameSession) out.push("⚠ QC INDEPENDENCE: a QC report was written in the same turn as code, so it is not independent. Re-run QC in a fresh context (Claude Code: the burhan-reviewer subagent), or record 'same session' as a limitation.");
  return out;
};

const gates: Gate[] = [gateA, gateB, gateD, gateE, gateF, gateG, gateI, gateH];

export const turnAudit: Check = (ctx) => {
  const auditCtx = { ...ctx, env: { ...ctx.env, ...ctx.cfg } };
  try {
    if (auditCtx.ev.get('.reentrant') === 'true') { evidenceRecord(auditCtx); return []; }
    const cmds = auditCtx.ev.list('.turn.shell_commands');
    const created = [...new Set(auditCtx.ev.list('.turn.files_created').map((file) => relPath(file, auditCtx.project)).filter(Boolean))].sort(codePointCompare);
    const edited = auditCtx.ev.list('.turn.files_edited').map((file) => relPath(file, auditCtx.project)).filter(Boolean);
    const shell = shellWrites(cmds).map((file) => relPath(file, auditCtx.project)).filter(Boolean);
    const written = [...new Set([...created, ...edited, ...shell])].sort(codePointCompare);
    const turn = auditCtx.ev.raw.turn;
    const rawSteps = turn !== null && typeof turn === 'object' && !Array.isArray(turn) && Array.isArray((turn as Record<string, unknown>).steps)
      ? (turn as Record<string, unknown>).steps as unknown[] : [];
    const steps = parseSteps(rawSteps, auditCtx.project);
    let item = explicitLink(cmds);
    if (item === '') {
      const files = steps.length > 0 ? steps.filter((step) => step.kind === 'edit').map((step) => step.file) : written;
      const prefix = `${auditCtx.cfg.WF_DOCS_DIR ?? ''}/`;
      for (const file of files) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest.includes('/')) continue;
        const candidate = rest.split('/')[0] ?? '';
        if (candidate !== '') item = candidate;
      }
    }
    if (item !== '') linkItem(auditCtx.project, auditCtx.ev.get('.session'), item, itemSlugs(stateNow(auditCtx.project, auditCtx.cfg)), auditCtx.env);
    const subWritten = steps.filter((step) => step.kind === 'edit' && step.by !== '').map((step) => step.file);
    const audit: Audit = { ctx: auditCtx, written, created, cmds, skillsUsed: auditCtx.ev.list('.turn.skills_used'), text: auditCtx.ev.get('.turn.assistant_text'), steps, subWritten };
    const findings: string[] = [];
    for (const gate of gates) try { findings.push(...gate(audit)); } catch { /* independent gates fail open */ }
    evidenceRecord(auditCtx);
    return findings;
  } catch {
    try { evidenceRecord(auditCtx); } catch { /* recording is independently fail-open */ }
    return [];
  }
};
