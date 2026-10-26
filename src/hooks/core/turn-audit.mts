/** Whole-turn audit (ported from the 0.2 bash turn-audit.sh). */
import { evidenceRecord } from './ledger.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ere, ereTest } from './ere.mjs';
import { itemBlock, itemField, itemResolved, itemRoute, itemSlugs, relPath, stateNow, type Check, type Ctx } from './lib.mjs';
import { explicitLink } from './link.mjs';
import { shellWrites } from './shell-writes.mjs';
import { agoText, liveOwnerAge, slugText } from './state-blocks.mjs';
import { clearStateSnapshot, fingerprintRefresh, linkedItem, linkItem, rememberedPhaseSkills, rememberedSkills, rememberPhaseSkills, rememberSkills, stateAfterSlugs, stateSnapshotFile } from './store.mjs';
import { evidenceRuns, lastCodeEdit, lastRunPerCommand, parseSteps, type Step } from './steps.mjs';
import { gateLine, undecided } from './understanding.mjs';

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
  /** Code-gate skills remembered for this item from earlier turns of this session (store.mts). */
  skillsBefore: string[];
  /** Phase skills this session used in earlier turns for the item, or before any item existed (store.mts). Answers "was it invoked", never "was the work done". */
  skillsEarlier: string[];
  /** Files this turn's shell commands wrote (`>`, `>>`, `tee`), sources dropped. */
  shellWritten: string[];
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
/** A file that can carry a status: markdown directly in the item folder or directly in its `reviews/`. Raw output and notes elsewhere are not read. */
const itemFileRe = (audit: Audit): string => `${docsRe(audit)}([^/]+|reviews/[^/]+)\\.md$`;
/** A file saved as an original input — `<docs>/<slug>/sources/…` at any depth. It is not work, so no gate looks at it. */
const sourcesRe = (audit: Pick<Audit, 'ctx'>): string => `^${escapeEre(audit.ctx.cfg.WF_DOCS_DIR ?? '')}/[^/]+/sources/`;
const discoveryRe = (audit: Audit): string => `^${escapeEre(audit.ctx.cfg.WF_DISCOVERY_DIR ?? '')}/[0-9]{4}-[0-9]{2}-[0-9]{2}-[^/]+\\.md$`;
const codeInTurn = (audit: Audit): boolean => {
  const code = audit.ctx.cfg.WF_CODE_REGEX ?? '';
  return matches(code, audit.written.join('\n')) || (code !== '' && lastCodeEdit(audit.steps, ere(code) ?? /$a/) !== null);
};
/** wf_item_now: the slug that applies to this session ('' = none — several blocks and no live link). */
const sessionSlug = (ctx: Ctx): string => {
  const now = stateNow(ctx.project, ctx.cfg);
  return itemResolved(now, linkedItem(ctx.project, ctx.ev.get('.session'), itemSlugs(now), ctx.env));
};
const resolvedSlug = (audit: Audit): string => sessionSlug(audit.ctx);
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


/** Work written under `<docs>/<slug>/` whose slug has no block under `## Now` of an existing state file: without a block burhan cannot link the
 *  session (store.mts linkItem), so the work's skills and evidence are recorded under no item. Said once, in the state-transition warning. */
const noBlockHint = (audit: Audit): string => {
  try {
    const state = audit.ctx.cfg.WF_STATE_FILE ?? '';
    const docs = audit.ctx.cfg.WF_DOCS_DIR ?? '';
    if (state === '' || docs === '' || !existsSync(join(audit.ctx.project, state))) return '';
    const blocks = new Set(itemSlugs(stateNow(audit.ctx.project, audit.ctx.cfg)));
    const slugs = [...new Set([...audit.written, ...audit.subWritten].filter((file) => file.startsWith(`${docs}/`)).map((file) => file.slice(docs.length + 1).split('/')).filter((parts) => parts.length > 1).map((parts) => parts[0]!))]
      .filter((slug) => !blocks.has(slug)).sort(codePointCompare);
    if (slugs.length === 0) return '';
    const named = slugs.slice(0, 3).map((slug) => `\`${slug}\``);
    const more = slugs.length > 3 ? ` and ${slugs.length - 3} more` : '';
    const adds = slugs.slice(0, 3).map((slug) => `a \`### ${slug}\``).join(' and ');
    return ` ${named.join(', ')}${more} ${slugs.length === 1 ? 'has' : 'have'} no block under "Now" in \`${state}\`: burhan cannot link this session to ${slugs.length === 1 ? 'it' : 'them'}, so its skills and evidence are recorded under no item. Add ${adds} block (route, mode).`;
  } catch { return ''; }
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
    ? [`⚠ STATE-TRANSITION GATE: a work-item file changed this turn but \`${state}\` was not updated. Write every transition before the turn ends (WORKFLOW §5): edit the existing line in place — no new paragraph, no copied detail (link the file).${noBlockHint(audit)}`]
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
  const eligible = `${itemFileRe(audit)}|${discoveryRe(audit)}`;
  for (const file of audit.written) {
    try {
      if (file.endsWith('/README.md') || file === 'README.md' || /\.log$/i.test(file) || !ereTest(eligible, file)) continue; // a raw command log is not a status file
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

/** The patch lane: a `patch — <reason>` routing line this turn, the item's route a patch when an item applies, and no
 *  sensitive path written (WORKFLOW §3). Shared by the skill gate and the baseline gate. */
const patchTurn = (audit: Audit): boolean => {
  let patch = ereTest('^[[:space:]>*_-]*patch\\**[[:space:]]*(—|–)', audit.text, { i: true });
  if (patch && resolvedSlug(audit) !== '') patch = ['change / patch', 'bug / patch', 'refactor / patch'].includes(itemRoute(resolvedItemNow(audit)));
  if (patch && (audit.ctx.cfg.WF_SENSITIVE_REGEX ?? '') !== '' && matches(audit.ctx.cfg.WF_SENSITIVE_REGEX ?? '', audit.written.join('\n'))) patch = false;
  return patch;
};

// ---- F ---------------------------------------------------------------------
const gateF: Gate = (audit) => {
  if (audit.ctx.cfg.WF_SKILLS !== 'superpowers') return [];
  const out: string[] = [];
  const docs = docsRe(audit);
  const used = (pattern: string): boolean => ereTest(pattern, audit.skillsUsed.join('\n'));
  // The story, plan and review checks read the same memory as the pre-write check: this turn plus the session's earlier turns.
  const usedEver = (pattern: string): boolean => ereTest(pattern, [...audit.skillsUsed, ...audit.skillsEarlier].join('\n'));
  if (ereTest(`${docs}.*-story\\.md$`, audit.created.join('\n')) && !usedEver('brainstorming')) out.push('⚠ SKILL GATE (story): a story was CREATED this turn without superpowers:brainstorming. Invoke it now if it was skipped, or say when it ran.');
  if (ereTest(`${docs}.*-implementation-plan\\.md$`, audit.created.join('\n')) && !usedEver('writing-plans')) out.push('⚠ SKILL GATE (plan): a plan was CREATED this turn without superpowers:writing-plans.');
  // The same two checks for a story or plan written through the shell: a redirection cannot tell a new file from an overwritten one, so the wording differs.
  if (!ereTest(`${docs}.*-story\\.md$`, audit.created.join('\n')) && ereTest(`${docs}.*-story\\.md$`, audit.shellWritten.join('\n')) && !usedEver('brainstorming')) out.push('⚠ SKILL GATE (story): a story was written through the shell this turn without superpowers:brainstorming. Invoke it now if it was skipped, or say when it ran.');
  if (!ereTest(`${docs}.*-implementation-plan\\.md$`, audit.created.join('\n')) && ereTest(`${docs}.*-implementation-plan\\.md$`, audit.shellWritten.join('\n')) && !usedEver('writing-plans')) out.push('⚠ SKILL GATE (plan): a plan was written through the shell this turn without superpowers:writing-plans.');
  const patch = patchTurn(audit);
  const usedForCode = ereTest('test-driven-development|systematic-debugging', [...audit.skillsUsed, ...audit.skillsBefore].join('\n'));
  if (matches(audit.ctx.cfg.WF_CODE_REGEX ?? '', audit.written.join('\n')) && !patch && !usedForCode) out.push('⚠ SKILL GATE (code): code was written this turn without superpowers:test-driven-development or superpowers:systematic-debugging. Confirm the skill was used, or invoke it before continuing.');
  // A review file counts when the main agent created it or added a `**Performed by:**` line to it; a fix note in a review
  // the reviewer wrote does not. Only the Claude adapter reports what was written, so Codex keeps the older rule.
  const claude = audit.ctx.ev.get('.agent') === 'claude';
  const performedBy = (text: string): boolean => ereTest('performed by:', text, { i: true });
  const addsReview = (file: string): boolean => audit.created.includes(file)
    || audit.steps.some((step) => step.kind === 'edit' && step.by === '' && step.file === file && step.performedBy)
    || audit.cmds.some((cmd) => performedBy(cmd) && shellWrites([cmd]).map((f) => relPath(f, audit.ctx.project)).includes(file));
  const reviews = audit.written.filter((file) => ereTest('/reviews/[^/]+\\.md$', file) && !ereTest('-(qc|verification)(-r[0-9]+)?\\.md$', file) && (!claude || addsReview(file)));
  if (reviews.length > 0 && !usedEver('requesting-code-review')) out.push('⚠ SKILL GATE: a review file was written this turn without superpowers:requesting-code-review.');
  // "After work": a file other than the state file and the discoveries, outside the patch lane (a state-only "✅" is bookkeeping, not a claim).
  const state = audit.ctx.cfg.WF_STATE_FILE ?? '';
  const discovery = audit.ctx.cfg.WF_DISCOVERY_DIR ?? '\u0000';
  const worked = audit.written.some((file) => file !== state && !file.startsWith(`${discovery}/`));
  if (worked && !patch && completionClaim(audit.text) && !used('verification-before-completion')) out.push('⚠ SKILL GATE (verify): completion was claimed after work this turn without superpowers:verification-before-completion. Invoke it before claiming done, or retract the claim.');
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
// Compared with the Now list taken just before this session's own first write of the state file in the turn (the pre-write hook), never with
// the list from the start of the session: a block another session removed, or added, meanwhile is not this session's doing. No baseline: silent.
const gateI: Gate = (audit) => {
  const state = audit.ctx.cfg.WF_STATE_FILE ?? '';
  if (!audit.written.includes(state)) return [];
  try {
    const mine = audit.ctx.ev.get('.session');
    const snap = stateSnapshotFile(audit.ctx.project, mine, audit.ctx.env);
    if (snap === '') return [];
    // The list right after this session's last edit-tool write of the state file, unless a shell write of it came in the turn (no post event
    // for a shell): then the file at the turn end, as before.
    const after = audit.shellWritten.includes(state) ? null : stateAfterSlugs(audit.ctx.project, mine, audit.ctx.env);
    const nowSlugs = new Set(after ?? itemSlugs(stateNow(audit.ctx.project, audit.ctx.cfg)));
    for (const removed of readFileSync(snap, 'utf8').split('\n')) {
      if (removed === '' || nowSlugs.has(removed)) continue;
      const age = liveOwnerAge(audit.ctx.project, mine, removed, audit.ctx.env);
      if (age !== null) return [`⚠ You removed the \`${slugText(removed)}\` block — another session (active ${agoText(age)}) is working on it. Put it back.`];
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

// ---- Baseline (project understanding) ------------------------------------
const gateBaseline: Gate = (audit) => {
  // The onboarding turn writes only memory files, so it never reaches this gate (no story, no code).
  const story = ereTest(`${docsRe(audit)}.*-story\\.md$`, audit.written.join('\n'));
  const code = codeInTurn(audit);
  if (!story && !code) return [];
  if (patchTurn(audit)) return [];
  const state = undecided(audit.ctx);
  if (state === null) return [];
  return [gateLine(story && code ? 'a story was written and code was edited' : story ? 'a story was written' : 'code was edited', state)];
};

const gates: Gate[] = [gateA, gateB, gateD, gateE, gateF, gateG, gateI, gateH, gateBaseline];

export const turnAudit: Check = (ctx) => {
  const auditCtx = { ...ctx, env: { ...ctx.env, ...ctx.cfg } };
  try {
    const remember = (): void => { try { rememberSkills(auditCtx.project, auditCtx.ev.get('.session'), sessionSlug(auditCtx), auditCtx.ev.list('.turn.skills_used'), auditCtx.env); rememberPhaseSkills(auditCtx.project, auditCtx.ev.get('.session'), sessionSlug(auditCtx), auditCtx.ev.list('.turn.skills_used'), auditCtx.env); } catch { /* fail open */ } };
    if (auditCtx.ev.get('.reentrant') === 'true') { clearStateSnapshot(auditCtx.project, auditCtx.ev.get('.session'), auditCtx.env); remember(); evidenceRecord(auditCtx); return []; }
    const cmds = auditCtx.ev.list('.turn.shell_commands');
    const created = [...new Set(auditCtx.ev.list('.turn.files_created').map((file) => relPath(file, auditCtx.project)).filter(Boolean))].sort(codePointCompare);
    const edited = auditCtx.ev.list('.turn.files_edited').map((file) => relPath(file, auditCtx.project)).filter(Boolean);
    const shell = shellWrites(cmds).map((file) => relPath(file, auditCtx.project)).filter(Boolean);
    const sources = sourcesRe({ ctx: auditCtx });
    const isSource = (file: string): boolean => ereTest(sources, file);
    const allWritten = [...new Set([...created, ...edited, ...shell])].sort(codePointCompare);
    const written = allWritten.filter((file) => !isSource(file));
    const turn = auditCtx.ev.raw.turn;
    const rawSteps = turn !== null && typeof turn === 'object' && !Array.isArray(turn) && Array.isArray((turn as Record<string, unknown>).steps)
      ? (turn as Record<string, unknown>).steps as unknown[] : [];
    const steps = parseSteps(rawSteps, auditCtx.project);
    let item = explicitLink(cmds);
    if (item === '') {
      const files = steps.length > 0 ? steps.filter((step) => step.kind === 'edit').map((step) => step.file) : allWritten; // a saved source is still work on its item
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
    const subWritten = steps.filter((step) => step.kind === 'edit' && step.by !== '').map((step) => step.file).filter((file) => !isSource(file));
    let skillsBefore: string[] = [];
    try { skillsBefore = rememberedSkills(auditCtx.project, auditCtx.ev.get('.session'), sessionSlug(auditCtx), auditCtx.env); } catch { /* fail open */ }
    let skillsEarlier: string[] = [];
    try { skillsEarlier = rememberedPhaseSkills(auditCtx.project, auditCtx.ev.get('.session'), sessionSlug(auditCtx), auditCtx.env); } catch { /* fail open */ }
    const audit: Audit = { ctx: auditCtx, written, created: created.filter((file) => !isSource(file)), cmds, skillsUsed: auditCtx.ev.list('.turn.skills_used'), skillsBefore, skillsEarlier, shellWritten: shell.filter((file) => !isSource(file)), text: auditCtx.ev.get('.turn.assistant_text'), steps: steps.filter((step) => step.kind !== 'edit' || !isSource(step.file)), subWritten };
    const findings: string[] = [];
    for (const gate of gates) try { findings.push(...gate(audit)); } catch { /* independent gates fail open */ }
    clearStateSnapshot(auditCtx.project, auditCtx.ev.get('.session'), auditCtx.env); // this audit judged every write since the last one
    remember();
    evidenceRecord(auditCtx);
    return findings;
  } catch {
    clearStateSnapshot(auditCtx.project, auditCtx.ev.get('.session'), auditCtx.env); // a baseline must never outlive its turn, whatever failed
    try { evidenceRecord(auditCtx); } catch { /* recording is independently fail-open */ }
    return [];
  }
};
