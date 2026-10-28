import { join, relative } from 'node:path';
import type { Io } from '../main.js';
import { checkText, crossCheck, hasContractMarker, storyIsApproved } from '../hooks/core/item-contract.mjs';
import { executableHash, qcVerdict } from '../hooks/core/item-model.mjs';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { openMaterial, tickMatching } from './gate-tick.js';
import { placeholderReport } from './placeholders.js';
import { fenced, itemFolder, overallStatus, planPath, planRoute, readOr, routeNeeds, RUNGS, setFieldLine, units, withRung } from './item-files.js';
import { assertInside, oneLine, today } from './item-io.js';
import { latestQcFile } from './items.js';
import { readProjectConfig } from './config.js';
import { docsLocation } from './status.js';

// A name that starts like a model or a tool is not a person (a known limit: it cannot list every spelling, and it refuses a person called "Claude Monet").
const AGENT_NAME = /^(claude|codex|haiku|sonnet|opus|fable|gpt|chatgpt|gemini|copilot|grok|anthropic|openai|llama|deepseek|cursor|agent|ai|assistant|bot|burhan|model|me|human)(?!\p{L})/iu;

/** The approval is a person's: a name, not an agent's, a placeholder, or a separator. */
export function person(by: string | undefined): string {
  if (by === undefined || by.trim() === '') throw new BurhanError('--by is needed: the name of the person who approves');
  const name = oneLine(by, '--by');
  if (!/\p{L}/u.test(name) || /[<>·]/.test(name) || AGENT_NAME.test(name)) throw new BurhanError(`--by must be the name of the person who approves (not an agent, a placeholder or a separator): "${name}"`);
  return name;
}

const NOTICE = 'it was run from the shell, so the turn-end report lists it as agent-run: it must be the approval you were given';

/** The text with `line` added after the first real (not fenced) line that starts with `after`; null when there is none. */
function insertAfter(text: string, after: RegExp, line: string): string | null {
  const lines = text.split('\n');
  const inFence = fenced(lines);
  const at = lines.findIndex((l, i) => !inFence[i] && after.test(l));
  if (at === -1) return null;
  lines.splice(at + 1, 0, lines[at]!.endsWith('\r') ? `${line}\r` : line);
  return lines.join('\n');
}

/** `burhan approve story|plan|qc <slug> --by <name>`: writes the approval in the exact form the checks read, and ticks the matching gate. */
export function approve(target: string, what: string | undefined, slug: string | undefined, o: { by?: string; docs?: string }, io: Io): number {
  if (what !== 'story' && what !== 'plan' && what !== 'qc') throw new BurhanError('approve needs story, plan or qc: approve <story|plan|qc> <slug> --by <name>');
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'approve');
  const by = person(o.by);
  const date = today();
  const planFile = planPath(dir, s);
  const plan = readOr(planFile);

  if (what === 'story') {
    const path = join(dir, `${s}-story.md`);
    const story = readOr(path);
    if (story === null) throw new BurhanError(`item "${s}" has no story`);
    if (storyIsApproved(story)) { io.stdout('approve: the story is already approved\n'); return 0; }
    const left = placeholderReport(project, story, 'story');
    if (left !== null) throw new BurhanError(`the story has ${left}: fill it in (burhan item check ${s})`);
    const updated = setFieldLine(story, 'Status', `Approved — ${by} · ${date}`);
    if (updated === null) throw new BurhanError('the story has no **Status:** line that is read: run burhan item check');
    assertInside(project, path);
    putFile(path, updated);
    if (plan !== null) { assertInside(project, planFile); putFile(planFile, tickMatching(plan, /^Story approved/i)); }
    io.stdout(`approve: story approved by ${by}; ${NOTICE}\n`);
    return 0;
  }

  if (what === 'plan') {
    if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
    const current = overallStatus(plan);
    if (current === null) throw new BurhanError('the plan has no **Overall status:** line: run burhan item check');
    if (current !== 'Draft') { io.stdout(`approve: the plan is already ${current}\n`); return 0; }
    const story = readOr(join(dir, `${s}-story.md`));
    // A route that is not exact needs everything (routeNeeds), so a broken Route line cannot skip the story.
    if (routeNeeds(planRoute(plan)).story && (story === null || !storyIsApproved(story))) throw new BurhanError('the story is not approved yet: burhan approve story first');
    const open = openMaterial(story ?? '');
    if (open.length > 0) throw new BurhanError(`a material question has no answer: ${open.join(', ')}`);
    // The plan is approved together with its build spec: a plan made with the contract needs the spec, and both must pass the checks.
    // Required for a plan made with the contract, and for any plan when the project has switched the contract on (a plan without the marker is no way round it).
    if (hasContractMarker(plan) || readProjectConfig(project).values.WF_ITEM_CONTRACT === 'on') {
      const spec = readOr(join(dir, `${s}-build-spec.md`));
      if (spec === null) throw new BurhanError(`the build spec ${s}-build-spec.md is missing: a plan is approved together with it (burhan item check ${s})`);
      const left = [placeholderReport(project, plan, 'plan'), placeholderReport(project, spec, 'build-spec')].filter((x): x is string => x !== null);
      if (left.length > 0) throw new BurhanError(`the plan and its build spec still have placeholders: ${left.join('; ')} (burhan item check ${s})`);
      const faults = [...checkText('plan', plan), ...checkText('build-spec', spec), ...crossCheck({ story, plan, spec })];
      if (faults.length > 0) throw new BurhanError(`the plan and its build spec break the checks: ${faults.map((f) => f.code).join(', ')} (burhan item check ${s})`);
    }
    const lines = plan.split('\n');
    for (const u of units(plan)) if (u.rung === 0) lines[u.line] = withRung(lines[u.line]!, 1);
    const approvedText = tickMatching(setFieldLine(lines.join('\n'), 'Overall status', 'Approved') ?? plan, /^Plan approved/i);
    // The fingerprint of what the executor follows, so the turn-end audit can tell a later edit of those parts from a status change.
    const updated = insertAfter(approvedText, /^- \*\*Overall status:\*\*/, `- **Executable parts:** ${executableHash(approvedText)}`) ?? approvedText;
    assertInside(project, planFile);
    putFile(planFile, updated);
    io.stdout(`approve: plan approved by ${by}; its Draft sub-units are now ${RUNGS[1][1]}; ${NOTICE}\n`);
    return 0;
  }

  const qcFile = latestQcFile(dir, s);
  const qc = readOr(qcFile);
  if (qc === null) throw new BurhanError('there is no QC report to accept');
  const faults = checkText('qc', qc);
  if (faults.length > 0) throw new BurhanError(`the QC report has a fault: ${faults[0]!.code}`);
  if (qcVerdict(qc) !== 'PASS') throw new BurhanError('the QC verdict is not PASS: a failed QC is not accepted');
  const accepted = `${by} · ${date}`;
  const updated = setFieldLine(qc, 'Accepted by', accepted) ?? insertAfter(qc, /\*\*Verdict:\*\*/, `- **Accepted by:** ${accepted}`);
  if (updated === null) throw new BurhanError('the QC report has no **Verdict:** line that is read: run burhan item check');
  assertInside(project, qcFile);
  putFile(qcFile, updated);
  if (plan !== null) { assertInside(project, planFile); putFile(planFile, tickMatching(plan, /^QC/i)); }
  io.stdout(`approve: ${relative(target, qcFile).split('\\').join('/')} accepted by ${by}; ${NOTICE}\n`);
  return 0;
}
