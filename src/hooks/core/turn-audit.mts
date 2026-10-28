/** Whole-turn audit (ported from the 0.2 bash turn-audit.sh). */
import { evidenceRecord } from './ledger.mjs';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ere, ereTest } from './ere.mjs';
import { itemBlock, itemField, itemResolved, itemRoute, itemSlugs, relPath, stateNow, type Check, type Ctx } from './lib.mjs';
import { explicitLink } from './link.mjs';
import { shellWrites } from './shell-writes.mjs';
import { agoText, liveOwnerAge, slugText } from './state-blocks.mjs';
import { approvalWordSeen, rememberApprovalWord, clearShellCreated, clearStateSnapshot, fingerprintRefresh, linkedItem, linkItem, rememberedPhaseSkills, rememberedSkills, rememberPhaseSkills, rememberSkills, shellCreated, stateAfterSlugs, stateSnapshotFile } from './store.mjs';
import { evidenceMatches } from './evidence-cmd.mjs';
import { evidenceRuns, lastCodeEdit, lastRunPerCommand, parseSteps, type Step } from './steps.mjs';
import { gateLine, undecided } from './understanding.mjs';
import { checkText, hasContractMarker, kindOf } from './item-contract.mjs';
import { deviations, executableHash, openDeviations, overallStatus, recordedHash } from './item-model.mjs';
import { routeOf, stageOf } from './item-stage.mjs';

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
  if (steps.length === 0) return cmds.some((cmd) => evidenceMatches(ere(evidence) ?? /$a/, cmd)) ? [] : ["⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification command ran this turn. Run the checks now and show the real output, or explicitly retract the claim."];
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
  // A run whose result was never recorded (Codex: no item or no exit code; Claude: no result yet) is not a pass; one passing run is enough.
  const unknown = finals.find((run) => run.status === 'unknown');
  if (unknown && !finals.some((run) => run.status === 'ok')) return [`⚠ VERIFICATION GATE: completion was claimed, but the result of \`${unknown.cmd}\` is unknown — no exit code was recorded for it. Run it in the foreground and show the output.`];
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
      if (!lstatSync(join(audit.ctx.project, file)).isFile()) continue; // a folder, a link or a FIFO is not read (a FIFO would block the hook)
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
  // The same two checks for a story or plan CREATED through the shell. The turn end cannot tell a new file from an appended one; the Bash pre-write hook
  // measured it before the command ran and left a marker. No marker (the hook did not run) → silent. The wording differs from the edit-tool one.
  const marked = shellCreated(audit.ctx.project, audit.ctx.ev.get('.session'), audit.ctx.env);
  const shellNew = audit.shellWritten.filter((file) => marked.includes(file));
  if (!ereTest(`${docs}.*-story\\.md$`, audit.created.join('\n')) && ereTest(`${docs}.*-story\\.md$`, shellNew.join('\n')) && !usedEver('brainstorming')) out.push('⚠ SKILL GATE (story): a story was written through the shell this turn without superpowers:brainstorming. Invoke it now if it was skipped, or say when it ran.');
  if (!ereTest(`${docs}.*-implementation-plan\\.md$`, audit.created.join('\n')) && ereTest(`${docs}.*-implementation-plan\\.md$`, shellNew.join('\n')) && !usedEver('writing-plans')) out.push('⚠ SKILL GATE (plan): a plan was written through the shell this turn without superpowers:writing-plans.');
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

// ---- Item files, stage and approvals (workflow-engine) ---------------------
/** A plain file's text under the project, or null (a missing file, a folder, a link: a link could lead outside the project). */
const plainText = (project: string, rel: string): string | null => {
  try { const path = join(project, rel); const st = lstatSync(path); return st.isFile() ? readFileSync(path, 'utf8') : null; } catch { return null; }
};
/** A file the shell wrote that looks new: made and last written within two seconds (an old file that was appended to has a long gap). A guess, used only
 *  where the pre-write marker (which exists only with the skills setting) is missing. */
const looksNew = (project: string, rel: string): boolean => {
  try { const st = statSync(join(project, rel)); return st.birthtimeMs > 0 && st.mtimeMs - st.birthtimeMs < 2000; } catch { return false; }
};
/** The text of the item's latest QC report: `<slug>-qc-rN.md` with the highest N, else `<slug>-qc.md`. */
const latestQcText = (project: string, dir: string, slug: string): string | null => {
  try {
    const re = new RegExp(`^${escapeEre(slug)}-qc(?:-r(\\d+))?\\.md$`);
    const best = readdirSync(join(project, dir, 'reviews')).map((name) => ({ name, n: re.exec(name) })).filter((x) => x.n !== null).sort((a, b) => Number(b.n![1] ?? 1) - Number(a.n![1] ?? 1))[0];
    return best === undefined ? null : plainText(project, `${dir}/reviews/${best.name}`);
  } catch { return null; }
};
const MAX_FAULTS = 5;

/** J: an item file the agent wrote directly must follow the contract. A file only edited is judged when it carries `**Contract:** 1` (a legacy file stays
 *  quiet); a file created by hand is judged whatever it carries and is told which command makes it. */
const gateContract: Gate = (audit) => {
  const docs = audit.ctx.cfg.WF_DOCS_DIR ?? '';
  if (docs === '' || audit.ctx.cfg.WF_ITEM_CONTRACT !== 'on') return [];
  const marked = shellCreated(audit.ctx.project, audit.ctx.ev.get('.session'), audit.ctx.env);
  const made = new Set([...audit.created, ...audit.shellWritten.filter((file) => marked.includes(file) || looksNew(audit.ctx.project, file))]);
  const out: string[] = [];
  for (const file of [...new Set(audit.written)]) {
    if (!ereTest(itemFileRe(audit), file)) continue;
    const kind = kindOf(file);
    const text = kind === null ? null : plainText(audit.ctx.project, file);
    if (kind === null || text === null) continue;
    const byHand = made.has(file);
    const marked = hasContractMarker(text);
    if (!byHand && !marked) {
      // An item file that lost its marker while a sibling still has it was most likely rewritten whole: say so, or every check would go quiet for it.
      const slugOf = file.slice(docs.length + 1).split('/')[0] ?? '';
      const sibling = ['story', 'implementation-plan', 'build-spec'].map((k) => `${docs}/${slugOf}/${slugOf}-${k}.md`).filter((f) => f !== file).some((f) => { const t = plainText(audit.ctx.project, f); return t !== null && hasContractMarker(t); });
      if (sibling && kind !== 'review' && kind !== 'qc' && kind !== 'verification') out.push(`⚠ CONTRACT GATE: \`${file}\` (${kind}) lost its **Contract:** 1 line while the item's other files still have it: the checks treat it as an old file. Put the line back (burhan item check ${slugOf} lists what else differs).`);
      continue;
    }
    const faults = checkText(kind, text);
    if (faults.length === 0 && (marked || !byHand)) continue;
    const slug = file.slice(docs.length + 1).split('/')[0] ?? '';
    const shown = faults.slice(0, MAX_FAULTS).map((f) => `${f.code}: ${f.message}`).join('; ');
    const rest = faults.length > MAX_FAULTS ? `; and ${faults.length - MAX_FAULTS} more` : '';
    const what = faults.length > 0 ? `breaks the contract (${shown}${rest})` : 'has no **Contract:** 1';
    out.push(`⚠ CONTRACT GATE: \`${file}\` (${kind}) was ${byHand ? 'created by hand' : 'edited'} and ${what}. ${byHand ? (kind === 'review' || kind === 'qc' || kind === 'verification' ? `burhan review add ${slug} --kind ${kind} --by "<agent · model · context>" writes it in the exact form. ` : 'burhan item new <slug> --type … --scope … makes it from the template. ') : ''}burhan item check ${slug} lists every fault.`);
  }
  return out;
};

/** K: code edited while the item's stage does not authorize it (the plan is not approved, or the route is read-only). The patch lane and an item with no
 *  files or no link stay silent: the hook cannot judge what it cannot read. */
const gateStage: Gate = (audit) => {
  if (audit.ctx.cfg.WF_ITEM_CONTRACT !== 'on' || !codeInTurn(audit) || patchTurn(audit)) return [];
  const slug = resolvedSlug(audit);
  const docs = audit.ctx.cfg.WF_DOCS_DIR ?? '';
  if (slug === '' || docs === '') return [];
  const blockRoute = itemRoute(resolvedItemNow(audit));
  if (blockRoute.endsWith(' / patch')) return [];
  const dir = `${docs}/${slug}`;
  const story = plainText(audit.ctx.project, `${dir}/${slug}-story.md`);
  const plan = plainText(audit.ctx.project, `${dir}/${slug}-implementation-plan.md`);
  const findings = plainText(audit.ctx.project, `${dir}/${slug}-findings.md`);
  if (story === null && plan === null && findings === null) return [];
  // Only an item made with the contract is judged: an old item stays quiet (AC-08); a hand-made file is the contract gate's business.
  if (![story, plan, findings].some((text) => text !== null && hasContractMarker(text))) return [];
  const stage = stageOf({ slug, route: routeOf(story, plan, findings) || blockRoute, story, plan, findings, qc: latestQcText(audit.ctx.project, dir, slug) });
  return stage.authorized ? [] : [`⚠ STAGE GATE: code was edited but ${slug} is "${stage.stage}" (${stage.why}). Next: ${stage.next}`];
};

/** The paths the build spec's "### Files" tables list (the first cell, in backticks; a `<placeholder>` is not a path). */
const specFiles = (spec: string): string[] => {
  const out: string[] = [];
  let inFiles = false;
  for (const raw of spec.split('\n')) {
    const l = raw.replace(/\r$/, '');
    if (/^#{2,4}[ \t]/.test(l)) inFiles = /^###[ \t]+files\b/i.test(l);
    else if (inFiles) {
      const cell = firstCell(l);
      if (cell !== null && !/^(path|-+|:?-+:?)$/i.test(cell) && !/^[<>]/.test(cell)) out.push(normPath(cell));
    }
  }
  return out;
};
/** The first cell of a table row (text between the first two pipes, backticks and spaces dropped); null when the line is no row or has no closing pipe. */
const firstCell = (line: string): string | null => {
  if (!line.startsWith('|')) return null;
  const end = line.indexOf('|', 1);
  if (end === -1) return null;
  const cell = line.slice(1, end).trim().replace(/^`|`$/g, '').trim();
  return cell === '' ? null : cell;
};
/** A path as the spec and the audit compare it: forward slashes, no leading `./`. */
const normPath = (file: string): string => file.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/** M: while the plan is Approved or In progress the executor follows the build spec: a code file the spec's Files tables do not list, or an edit of the spec
 *  itself, needs an approved deviation first (`burhan deviation add`, the owner's `deviation resolve`). With a deviation open the stage gate speaks instead. */
const gateDeviation: Gate = (audit) => {
  if (audit.ctx.cfg.WF_ITEM_CONTRACT !== 'on') return [];
  const slug = resolvedSlug(audit);
  const docs = audit.ctx.cfg.WF_DOCS_DIR ?? '';
  if (slug === '' || docs === '') return [];
  const dir = `${docs}/${slug}`;
  const plan = plainText(audit.ctx.project, `${dir}/${slug}-implementation-plan.md`);
  if (plan === null || !hasContractMarker(plan)) return [];
  const status = overallStatus(plan);
  if (status !== 'Approved' && status !== 'In progress') return [];
  if (openDeviations(plan).length > 0) return [];
  const out: string[] = [];
  const how = `Record it with burhan deviation add ${slug} --unit N --what … --where … --output …, STOP, and ask the owner; an approved deviation updates the plan and the build spec first, then the code.`;
  const specRel = `${dir}/${slug}-build-spec.md`;
  const written = [...new Set(audit.written)];
  if (written.includes(specRel) && !deviations(plan).some((d) => d.status === 'approved')) out.push(`⚠ DEVIATION GATE: the build spec of ${slug} was edited after its plan was approved and no deviation is approved. ${how}`);
  const planRel = `${dir}/${slug}-implementation-plan.md`;
  const fingerprint = recordedHash(plan);
  if (written.includes(planRel) && fingerprint !== null && fingerprint !== executableHash(plan) && !deviations(plan).some((d) => d.status === 'approved')) out.push(`⚠ DEVIATION GATE: the executable parts of the plan of ${slug} (AC coverage, executor rules, a sub-unit's Covers line) were edited after approval and no deviation is approved. ${how}`);
  const spec = plainText(audit.ctx.project, specRel);
  const listed = spec === null ? [] : specFiles(spec);
  if (listed.length > 0) {
    const code = audit.ctx.cfg.WF_CODE_REGEX ?? '';
    const inside = (file: string): boolean => !/^([A-Za-z]:|\/|\.\.\/)/.test(normPath(file)); // a path outside the project is not judged
    const off = written.map(normPath).filter((file) => inside(file) && file !== specRel && !file.startsWith(`${docs}/`) && !file.startsWith('.burhan/') && matches(code, file) && !listed.includes(file));
    if (off.length > 0) out.push(`⚠ DEVIATION GATE: ${off.join(', ')} ${off.length === 1 ? 'was' : 'were'} edited but the build spec of ${slug} does not list ${off.length === 1 ? 'it' : 'them'}. ${how}`);
  }
  return out;
};

/** `approve story|plan|qc <slug>` behind any launcher (burhan, burhan-kit, node …/cli.js, npx, npm exec, pnpm dlx, bash -c, an env prefix, a sub-shell). A segment that
 *  only shows text (echo, printf, grep, git, cat …) is not a command. Forms it cannot see (a script file, an alias) are missed: the gate reports what it recognises. */
const APPROVE_CMD = /(?:^|[\s/\\'"=(])(?:burhan(?:-kit)?|cli\.js)(?![\w/\\-])[^\n]{0,2000}?\b(?:approve\s+(story|plan|qc)|deviation\s+(resolve))(?:\s+--?[A-Za-z][\w-]*(?:[ =][^\s-][^\s]*)?){0,6}\s+['"]?([A-Za-z0-9._][A-Za-z0-9._-]*(?:['"]?\s+\d+)?)/;
/** The command without the bodies of its here-documents: text a command only carries (a note, a commit message) is not a command it runs. */
const stripHeredocs = (cmd: string): string => {
  const out: string[] = [];
  let end: string | null = null;
  for (const line of cmd.split('\n')) {
    if (end !== null) { if (line.trim() === end) end = null; continue; }
    out.push(line);
    const m = /(?<![\w<])<<(?!<)-?[ \t]*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
    if (m) end = m[1]!;
  }
  return out.join('\n');
};
const TEXT_ONLY_CMD = /^\s*(?:echo|printf|grep|egrep|rg|cat|head|tail|less|man|git|gh|curl|wget|sed|awk)\b/;
/** L: the agent ran `burhan approve` this turn. An approval is the owner's, so the run is always reported, and flagged when the owner's message had no
 *  approval wording (a heuristic: it shows wording, not consent). The wording is spent by the report: the next approve needs the owner's next message. */
const gateApproval: Gate = (audit) => {
  const ran = audit.cmds.flatMap((cmd) => stripHeredocs(cmd.replace(/\\\r?\n/g, ' ')).split(/&&|\|\||;|\||\n/)).filter((part) => !TEXT_ONLY_CMD.test(part)).map((part) => APPROVE_CMD.exec(part)).filter((m): m is RegExpExecArray => m !== null);
  if (ran.length === 0) return [];
  const list = [...new Set(ran.map((m) => (m[1] !== undefined ? `approve ${m[1]} ${m[3]}` : `deviation resolve ${m[3]}`)))].join(', ');
  const session = audit.ctx.ev.get('.session');
  const said = approvalWordSeen(audit.ctx.project, session, audit.ctx.env);
  rememberApprovalWord(audit.ctx.project, session, false, audit.ctx.env);
  return said
    ? [`ℹ APPROVAL: the agent ran ${list} this turn; the owner's message had approval wording. Confirm it is what they approved.`]
    : [`⚠ APPROVAL GATE: the agent ran ${list} this turn but the owner's message had no approval wording. An approval is the owner's: if they did not say yes, set the status back and ask.`];
};

const gates: Gate[] = [gateA, gateB, gateD, gateE, gateF, gateG, gateI, gateH, gateBaseline, gateContract, gateStage, gateDeviation, gateApproval];

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
    clearShellCreated(auditCtx.project, auditCtx.ev.get('.session'), auditCtx.env); // the created paths were judged with it
    remember();
    evidenceRecord(auditCtx);
    return findings;
  } catch {
    clearStateSnapshot(auditCtx.project, auditCtx.ev.get('.session'), auditCtx.env); // a baseline must never outlive its turn, whatever failed
    clearShellCreated(auditCtx.project, auditCtx.ev.get('.session'), auditCtx.env);
    try { evidenceRecord(auditCtx); } catch { /* recording is independently fail-open */ }
    return [];
  }
};
